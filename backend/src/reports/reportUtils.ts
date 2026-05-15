import { createHash } from "node:crypto";

import type { ScanComparison, ScanPage, ScanRecord, ScanSummary } from "../types/scan.js";

const DEFAULT_MAX_MERMAID_NODES = 200;

interface MermaidOptions {
  maxNodes?: number;
}

function escapeCsv(value: string | number | boolean | null): string {
  if (value === null) {
    return "";
  }

  const text = String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\n/g, " ").trim();
}

function preferredPageKey(page: Pick<ScanPage, "normalizedUrl" | "url">): string {
  return page.normalizedUrl || page.url;
}

function readablePathLabel(page: ScanPage): string {
  if (page.path && page.path !== "/") {
    return page.path;
  }

  try {
    return new URL(page.url).hostname;
  } catch {
    return page.url;
  }
}

function stableNodeId(page: ScanPage): string {
  return `N${createHash("sha1").update(preferredPageKey(page)).digest("hex").slice(0, 8)}`;
}

export function generatePagesCsv(pages: ScanPage[]): string {
  const headers = [
    "URL",
    "status",
    "title",
    "path",
    "image count",
    "document count",
    "internal link count",
    "external link count",
    "word count",
    "missing title",
    "missing meta description",
    "H1 count",
    "crawl error"
  ];
  const rows = pages.map((page) =>
    [
      page.url,
      page.httpStatus,
      page.title,
      page.path,
      page.imageCount,
      page.documentLinkCount,
      page.internalLinkCount,
      page.externalLinkCount,
      page.wordCount,
      page.title.trim().length === 0,
      !page.hasMetaDescription,
      page.h1Count,
      page.crawlError
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export function generateScansCsv(scans: ScanSummary[]): string {
  const headers = [
    "Scan ID",
    "Root URL",
    "Hostname",
    "Status",
    "Started",
    "Finished",
    "Duration seconds",
    "Path boundary",
    "Total pages crawled",
    "Total images found",
    "Total documents linked",
    "Broken internal links",
    "Pages missing title",
    "Pages missing meta description",
    "Pages with no H1",
    "Error message"
  ];

  const rows = scans.map((scan) => {
    const startedAt = new Date(scan.startTime).getTime();
    const finishedAt = new Date(scan.endTime).getTime();
    const durationSeconds = Number.isNaN(startedAt) || Number.isNaN(finishedAt) || finishedAt < startedAt
      ? ""
      : Math.round((finishedAt - startedAt) / 1000);

    return [
      scan.id,
      scan.rootUrl,
      scan.hostname,
      scan.status,
      scan.startTime,
      scan.endTime,
      durationSeconds,
      scan.pathBoundary,
      scan.totalPagesCrawled,
      scan.totalImagesFound,
      scan.totalDocumentsLinked,
      scan.brokenInternalLinks,
      scan.pagesMissingTitle,
      scan.pagesMissingMetaDescription,
      scan.pagesWithNoH1,
      scan.errorMessage
    ]
      .map((value) => escapeCsv(value ?? null))
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export function generateMermaidFlowchart(
  pages: ScanPage[],
  options: MermaidOptions = {}
): string {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_MERMAID_NODES;
  const limitedPages = pages.slice(0, maxNodes);
  const lines = ["flowchart TD"];

  if (pages.length > maxNodes) {
    lines.push(`%% Diagram truncated to first ${maxNodes} pages`);
  }

  for (const page of limitedPages) {
    lines.push(`  ${stableNodeId(page)}["${escapeMermaidLabel(readablePathLabel(page))}"]`);
  }

  const pageByKey = new Map(limitedPages.map((page) => [preferredPageKey(page), page]));
  const seenEdges = new Set<string>();

  for (const page of limitedPages) {
    if (!page.parentUrl) {
      continue;
    }

    const parentPage = pageByKey.get(page.parentUrl) ??
      limitedPages.find((candidate) => candidate.url === page.parentUrl);

    if (!parentPage) {
      continue;
    }

    const edge = `${stableNodeId(parentPage)}-->${stableNodeId(page)}`;

    if (seenEdges.has(edge)) {
      continue;
    }

    seenEdges.add(edge);
    lines.push(`  ${stableNodeId(parentPage)} --> ${stableNodeId(page)}`);
  }

  return lines.join("\n");
}

export function compareScans(
  latestScan: Pick<ScanRecord, "id" | "pages">,
  previousScan: Pick<ScanRecord, "id" | "pages"> | null
): ScanComparison {
  const latestPages = latestScan.pages;
  const previousPages = previousScan?.pages ?? [];
  const latestMap = new Map(latestPages.map((page) => [preferredPageKey(page), page]));
  const previousMap = new Map(previousPages.map((page) => [preferredPageKey(page), page]));
  const addedUrls: string[] = [];
  const removedUrls: string[] = [];
  const changedUrls: string[] = [];
  const changedStatusUrls: string[] = [];

  for (const [key, latestPage] of latestMap) {
    const previousPage = previousMap.get(key);

    if (!previousPage) {
      addedUrls.push(key);
      continue;
    }

    if (latestPage.contentHash !== previousPage.contentHash) {
      changedUrls.push(key);
    }

    if (latestPage.httpStatus !== previousPage.httpStatus) {
      changedStatusUrls.push(key);
    }
  }

  for (const [key] of previousMap) {
    if (!latestMap.has(key)) {
      removedUrls.push(key);
    }
  }

  return {
    scanId: latestScan.id,
    previousScanId: previousScan?.id ?? null,
    addedUrls,
    removedUrls,
    changedUrls,
    changedStatusUrls,
    summary: {
      addedPages: addedUrls.length,
      removedPages: removedUrls.length,
      changedPages: changedUrls.length,
      changedStatusPages: changedStatusUrls.length
    }
  };
}
