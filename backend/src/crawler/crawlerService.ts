import { createHash } from "node:crypto";

import { load } from "cheerio";

import { isPathWithinBoundary, normalisePathBoundary } from "../security/pathBoundary.js";
import { isAllowedDomain, isPrivateOrLocalHostname, isSameOrigin, normaliseUrl, shouldSkipUrl } from "../security/urlSafety.js";
import type { ScanPage } from "../types/scan.js";
import type {
  CrawlProgressEvent,
  CrawlRequest,
  CrawlResult,
  CrawlerDependencies,
  FetchLike,
  FetchResponseLike
} from "./types.js";

const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
  ".zip"
]);

const PAGE_ASSET_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".css",
  ".js",
  ".json",
  ".xml",
  ".txt",
  ".mp4",
  ".mp3",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
  ".zip"
]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface QueueItem {
  parentUrl: string | null;
  url: URL;
}

function normalizeRequestPathBoundary(pathBoundary: string | null): string | null {
  return pathBoundary ? normalisePathBoundary(pathBoundary) : null;
}

function getAllowedBoundaryHostnames(
  rootHostname: string,
  allowedDomains: string[],
  crawlAllowedHostVariants: boolean
): Set<string> {
  const boundaryHostnames = new Set<string>([rootHostname]);

  if (!crawlAllowedHostVariants) {
    return boundaryHostnames;
  }

  const counterpartHostname = rootHostname.startsWith("www.")
    ? rootHostname.slice(4)
    : `www.${rootHostname}`;

  if (allowedDomains.includes(counterpartHostname)) {
    boundaryHostnames.add(counterpartHostname);
  }

  return boundaryHostnames;
}

function isWithinCrawlBoundary(
  candidateUrl: URL,
  rootUrl: URL,
  request: CrawlRequest,
  boundaryHostnames: Set<string>
): boolean {
  if (!["http:", "https:"].includes(candidateUrl.protocol)) {
    return false;
  }

  if (request.config.crawlAllowedHostVariants) {
    return boundaryHostnames.has(candidateUrl.hostname) &&
      isAllowedDomain(candidateUrl, request.config.allowedDomains);
  }

  return isSameOrigin(candidateUrl, rootUrl.origin);
}

function isWithinPathBoundary(candidateUrl: URL, pathBoundary: string | null): boolean {
  if (!pathBoundary) {
    return true;
  }

  return isPathWithinBoundary(candidateUrl.pathname, pathBoundary);
}

function getPathExtension(url: URL): string {
  const lastSegment = url.pathname.split("/").pop() ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");

  if (dotIndex === -1) {
    return "";
  }

  return lastSegment.slice(dotIndex).toLowerCase();
}

function isDocumentUrl(url: URL): boolean {
  return DOCUMENT_EXTENSIONS.has(getPathExtension(url));
}

function isAssetUrl(url: URL): boolean {
  return PAGE_ASSET_EXTENSIONS.has(getPathExtension(url));
}

function contentHash(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function approximateWordCount(text: string): number {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);

  return words.length;
}

function buildErrorPage(url: URL, parentUrl: string | null, message: string, finalUrl?: string): ScanPage {
  return {
    url: url.toString(),
    normalizedUrl: url.toString(),
    path: url.pathname || "/",
    parentUrl,
    httpStatus: 0,
    finalUrl: finalUrl ?? url.toString(),
    title: "",
    hasMetaDescription: false,
    h1Count: 0,
    internalLinkCount: 0,
    externalLinkCount: 0,
    imageCount: 0,
    documentLinkCount: 0,
    wordCount: 0,
    contentHash: "",
    crawlError: message
  };
}

function defaultFetch(input: string, init?: Parameters<typeof fetch>[1]) {
  return fetch(input, init);
}

async function emitProgress(
  request: CrawlRequest,
  event: CrawlProgressEvent
) {
  if (!request.onProgress) {
    return;
  }

  await request.onProgress(event);
}

async function fetchHtmlWithRedirectChecks(
  url: URL,
  rootUrl: URL,
  request: CrawlRequest,
  boundaryHostnames: Set<string>,
  pathBoundary: string | null,
  fetchImpl: FetchLike
): Promise<{ body: string; finalUrl: URL; response: FetchResponseLike }> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.config.requestTimeoutMs);

    try {
      const response = await fetchImpl(currentUrl.toString(), {
        headers: {
          "user-agent": request.config.userAgent
        },
        redirect: "manual",
        signal: controller.signal
      });
      const location = response.headers.get("location");

      if (response.status >= 300 && response.status < 400 && location) {
        const nextUrl = normaliseUrl(location, currentUrl.toString(), {
          stripQueryString: request.config.stripQueryStrings
        });

        if (
          shouldSkipUrl(nextUrl.toString()) ||
          isPrivateOrLocalHostname(nextUrl.hostname) ||
          !isAllowedDomain(nextUrl, request.config.allowedDomains) ||
          !isWithinCrawlBoundary(nextUrl, rootUrl, request, boundaryHostnames) ||
          !isWithinPathBoundary(nextUrl, pathBoundary)
        ) {
          throw new Error(`Redirect target is not allowed: ${nextUrl.toString()}`);
        }

        currentUrl = nextUrl;
        continue;
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

      if (!contentType.includes("text/html")) {
        throw new Error(`Non-HTML content type: ${contentType || "unknown"}`);
      }

      const body = await response.text();
      const finalUrl = normaliseUrl(response.url || currentUrl.toString(), undefined, {
        stripQueryString: request.config.stripQueryStrings
      });

      if (
        isPrivateOrLocalHostname(finalUrl.hostname) ||
        !isAllowedDomain(finalUrl, request.config.allowedDomains) ||
        !isWithinCrawlBoundary(finalUrl, rootUrl, request, boundaryHostnames) ||
        !isWithinPathBoundary(finalUrl, pathBoundary)
      ) {
        throw new Error(`Final response URL is not allowed: ${finalUrl.toString()}`);
      }

      return {
        body,
        finalUrl,
        response
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Too many redirects for ${url.toString()}`);
}

function classifyAnchorUrl(
  candidateUrl: URL,
  rootUrl: URL,
  request: CrawlRequest,
  boundaryHostnames: Set<string>,
  pathBoundary: string | null
): "internal-page" | "internal-document" | "external" | "skip" {
  if (isPrivateOrLocalHostname(candidateUrl.hostname)) {
    return "skip";
  }

  if (!isWithinCrawlBoundary(candidateUrl, rootUrl, request, boundaryHostnames)) {
    return "external";
  }

  if (!isWithinPathBoundary(candidateUrl, pathBoundary)) {
    return "external";
  }

  if (isAssetUrl(candidateUrl)) {
    return isDocumentUrl(candidateUrl) ? "internal-document" : "skip";
  }

  return "internal-page";
}

export class CrawlerService {
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(dependencies: CrawlerDependencies = {}) {
    this.fetchImpl = dependencies.fetchImpl ?? defaultFetch;
    this.sleepImpl = dependencies.sleep ?? sleep;
  }

  async crawl(request: CrawlRequest): Promise<CrawlResult> {
    const rootUrl = normaliseUrl(request.rootUrl, undefined, {
      stripQueryString: request.config.stripQueryStrings
    });

    if (shouldSkipUrl(rootUrl.toString())) {
      throw new Error("Root URL uses an unsupported or skipped protocol");
    }

    if (isPrivateOrLocalHostname(rootUrl.hostname)) {
      throw new Error("Root URL hostname is private, local, or otherwise unsafe");
    }

    if (!isAllowedDomain(rootUrl, request.config.allowedDomains)) {
      throw new Error("Root URL hostname is not in allowedDomains");
    }

    const pathBoundary = normalizeRequestPathBoundary(request.config.pathBoundary);

    if (pathBoundary && !isPathWithinBoundary(rootUrl.pathname, pathBoundary)) {
      throw new Error("Root URL path is outside the configured pathBoundary");
    }

    const boundaryHostnames = getAllowedBoundaryHostnames(
      rootUrl.hostname,
      request.config.allowedDomains,
      request.config.crawlAllowedHostVariants
    );
    const queue: QueueItem[] = [{ parentUrl: null, url: rootUrl }];
    const seen = new Set<string>([rootUrl.toString()]);
    const pages: ScanPage[] = [];

    await emitProgress(request, {
      type: "scan_started",
      crawledPages: 0,
      currentUrl: rootUrl.toString(),
      maxPages: request.config.maxPages,
      message: "Scan started",
      queuedPages: queue.length
    });
    await emitProgress(request, {
      type: "page_queued",
      crawledPages: 0,
      currentUrl: rootUrl.toString(),
      maxPages: request.config.maxPages,
      message: "Queued root URL",
      queuedPages: queue.length
    });

    while (queue.length > 0 && pages.length < request.config.maxPages) {
      const current = queue.shift()!;

      await emitProgress(request, {
        type: "page_started",
        crawledPages: pages.length,
        currentUrl: current.url.toString(),
        maxPages: request.config.maxPages,
        message: "Crawling page",
        queuedPages: queue.length
      });

      if (pages.length > 0 && request.config.crawlDelayMs > 0) {
        await this.sleepImpl(request.config.crawlDelayMs);
      }

      try {
        const { body, finalUrl, response } = await fetchHtmlWithRedirectChecks(
          current.url,
          rootUrl,
          request,
          boundaryHostnames,
          pathBoundary,
          this.fetchImpl
        );
        const $ = load(body);
        const title = $("title").first().text().trim();
        const hasMetaDescription = $('meta[name="description"]').length > 0;
        const h1Count = $("h1").length;
        let internalLinkCount = 0;
        let externalLinkCount = 0;
        let documentLinkCount = 0;
        const imageCount = $("img").length;

        $("a[href]").each((_index, element) => {
          const href = $(element).attr("href");

          if (!href || shouldSkipUrl(href)) {
            return;
          }

          let candidateUrl: URL;

          try {
            candidateUrl = normaliseUrl(href, finalUrl.toString(), {
              stripQueryString: request.config.stripQueryStrings
            });
          } catch {
            return;
          }

          const classification = classifyAnchorUrl(
            candidateUrl,
            rootUrl,
            request,
            boundaryHostnames,
            pathBoundary
          );

          if (classification === "external") {
            externalLinkCount += 1;
            void emitProgress(request, {
              type: "page_skipped",
              crawledPages: pages.length,
              currentUrl: candidateUrl.toString(),
              maxPages: request.config.maxPages,
              message: "Link was outside the crawl boundary",
              queuedPages: queue.length
            });
            return;
          }

          if (classification === "internal-document") {
            documentLinkCount += 1;
            void emitProgress(request, {
              type: "page_skipped",
              crawledPages: pages.length,
              currentUrl: candidateUrl.toString(),
              maxPages: request.config.maxPages,
              message: "Document link counted but not crawled",
              queuedPages: queue.length
            });
            return;
          }

          if (classification === "internal-page") {
            internalLinkCount += 1;

            if (
              !seen.has(candidateUrl.toString()) &&
              pages.length + queue.length < request.config.maxPages &&
              isAllowedDomain(candidateUrl, request.config.allowedDomains)
            ) {
              seen.add(candidateUrl.toString());
              queue.push({
                parentUrl: finalUrl.toString(),
                url: candidateUrl
              });
              void emitProgress(request, {
                type: "page_queued",
                crawledPages: pages.length,
                currentUrl: candidateUrl.toString(),
                maxPages: request.config.maxPages,
                message: "Queued linked page",
                queuedPages: queue.length
              });
            }
          }
        });

        const page = {
          url: current.url.toString(),
          normalizedUrl: current.url.toString(),
          path: current.url.pathname || "/",
          parentUrl: current.parentUrl,
          httpStatus: response.status,
          finalUrl: finalUrl.toString(),
          title,
          hasMetaDescription,
          h1Count,
          internalLinkCount,
          externalLinkCount,
          imageCount,
          documentLinkCount,
          wordCount: approximateWordCount($("body").text()),
          contentHash: contentHash(body),
          crawlError: null
        };
        pages.push(page);
        await emitProgress(request, {
          type: "page_finished",
          crawledPages: pages.length,
          currentUrl: finalUrl.toString(),
          maxPages: request.config.maxPages,
          message: "Page crawled",
          page,
          queuedPages: queue.length
        });
      } catch (error) {
        const page = buildErrorPage(
          current.url,
          current.parentUrl,
          error instanceof Error ? error.message : "Unknown crawl error"
        );
        pages.push(page);
        await emitProgress(request, {
          type: "page_failed",
          crawledPages: pages.length,
          currentUrl: current.url.toString(),
          maxPages: request.config.maxPages,
          message: page.crawlError ?? "Page failed",
          page,
          queuedPages: queue.length
        });
      }
    }

    await emitProgress(request, {
      type: "scan_completed",
      crawledPages: pages.length,
      currentUrl: null,
      maxPages: request.config.maxPages,
      message: "Scan completed",
      queuedPages: queue.length
    });

    return {
      rootUrl: rootUrl.toString(),
      origin: rootUrl.origin,
      hostname: rootUrl.hostname,
      pathBoundary,
      pages
    };
  }
}
