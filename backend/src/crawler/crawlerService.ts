import { createHash } from "node:crypto";

import { load } from "cheerio";

import { isAllowedDomain, isPrivateOrLocalHostname, isSameOrigin, normaliseUrl, shouldSkipUrl } from "../security/urlSafety.js";
import type { ScanPage } from "../types/scan.js";
import type { CrawlRequest, CrawlResult, CrawlerDependencies, FetchLike, FetchResponseLike } from "./types.js";

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

async function fetchHtmlWithRedirectChecks(
  url: URL,
  request: CrawlRequest,
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
          !isSameOrigin(nextUrl, url.origin)
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
        !isSameOrigin(finalUrl, url.origin)
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

function classifyAnchorUrl(candidateUrl: URL, rootOrigin: string): "internal-page" | "internal-document" | "external" | "skip" {
  if (isPrivateOrLocalHostname(candidateUrl.hostname)) {
    return "skip";
  }

  if (!isSameOrigin(candidateUrl, rootOrigin)) {
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

    const queue: QueueItem[] = [{ parentUrl: null, url: rootUrl }];
    const seen = new Set<string>([rootUrl.toString()]);
    const pages: ScanPage[] = [];

    while (queue.length > 0 && pages.length < request.config.maxPages) {
      const current = queue.shift()!;

      if (pages.length > 0 && request.config.crawlDelayMs > 0) {
        await this.sleepImpl(request.config.crawlDelayMs);
      }

      try {
        const { body, finalUrl, response } = await fetchHtmlWithRedirectChecks(
          current.url,
          request,
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

          const classification = classifyAnchorUrl(candidateUrl, rootUrl.origin);

          if (classification === "external") {
            externalLinkCount += 1;
            return;
          }

          if (classification === "internal-document") {
            documentLinkCount += 1;
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
            }
          }
        });

        pages.push({
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
        });
      } catch (error) {
        pages.push(
          buildErrorPage(
            current.url,
            current.parentUrl,
            error instanceof Error ? error.message : "Unknown crawl error"
          )
        );
      }
    }

    return {
      rootUrl: rootUrl.toString(),
      origin: rootUrl.origin,
      hostname: rootUrl.hostname,
      pages
    };
  }
}
