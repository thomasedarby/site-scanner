import { createHash } from "node:crypto";

import type { CreateScanInput, ScanComparison, ScanPage, ScanRecord, ScanSummary } from "../types/scan.js";

function escapeCsv(value: string | number | boolean | null): string {
  if (value === null) {
    return "";
  }

  const stringValue = String(value);

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }

  return stringValue;
}

function buildContentHash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export class MockScanService {
  private scans: ScanRecord[] = [];
  private nextId = 1;

  createScan(input: CreateScanInput): ScanRecord {
    const rootUrl = new URL(input.url);
    const scanId = `scan-${this.nextId++}`;
    const now = new Date().toISOString();
    const aboutUrl = new URL("/about", rootUrl);
    const pages: ScanPage[] = [
      {
        url: rootUrl.toString(),
        normalizedUrl: rootUrl.toString(),
        path: rootUrl.pathname || "/",
        parentUrl: null,
        httpStatus: 200,
        finalUrl: rootUrl.toString(),
        title: "Mock Home",
        hasMetaDescription: true,
        h1Count: 1,
        internalLinkCount: 1,
        externalLinkCount: 0,
        imageCount: 2,
        documentLinkCount: 1,
        wordCount: 320,
        contentHash: buildContentHash(rootUrl.toString()),
        crawlError: null
      },
      {
        url: aboutUrl.toString(),
        normalizedUrl: aboutUrl.toString(),
        path: aboutUrl.pathname || "/about",
        parentUrl: rootUrl.toString(),
        httpStatus: 200,
        finalUrl: aboutUrl.toString(),
        title: "Mock About",
        hasMetaDescription: true,
        h1Count: 1,
        internalLinkCount: 1,
        externalLinkCount: 1,
        imageCount: 1,
        documentLinkCount: 0,
        wordCount: 180,
        contentHash: buildContentHash(aboutUrl.toString()),
        crawlError: null
      }
    ].slice(0, Math.max(1, Math.min(input.maxPages, 2)));
    const mermaidSitemap = [
      "flowchart TD",
      `  A["${rootUrl.pathname || "/"}"]`,
      ...(pages.length > 1 ? [`  B["${aboutUrl.pathname}"]`, "  A --> B"] : [])
    ].join("\n");
    const scan: ScanRecord = {
      id: scanId,
      rootUrl: rootUrl.toString(),
      origin: rootUrl.origin,
      hostname: rootUrl.hostname,
      pathBoundary: input.pathBoundary ?? null,
      startTime: now,
      endTime: now,
      status: "completed",
      totalPagesCrawled: pages.length,
      totalImagesFound: pages.reduce((sum, page) => sum + page.imageCount, 0),
      totalDocumentsLinked: pages.reduce((sum, page) => sum + page.documentLinkCount, 0),
      brokenInternalLinks: 0,
      pagesMissingTitle: pages.filter((page) => page.title.length === 0).length,
      pagesMissingMetaDescription: pages.filter((page) => !page.hasMetaDescription).length,
      pagesWithNoH1: pages.filter((page) => page.h1Count === 0).length,
      mermaidSitemap,
      errorMessage: null,
      pages
    };

    this.scans.unshift(scan);

    return scan;
  }

  listScans(): ScanSummary[] {
    return this.scans.map(({ pages: _pages, ...summary }) => summary);
  }

  getScan(id: string): ScanRecord | null {
    return this.scans.find((scan) => scan.id === id) ?? null;
  }

  getPagesCsv(id: string): string | null {
    const scan = this.getScan(id);

    if (!scan) {
      return null;
    }

    const headers = [
      "url",
      "normalizedUrl",
      "path",
      "parentUrl",
      "httpStatus",
      "finalUrl",
      "title",
      "hasMetaDescription",
      "h1Count",
      "internalLinkCount",
      "externalLinkCount",
      "imageCount",
      "documentLinkCount",
      "wordCount",
      "contentHash",
      "crawlError"
    ];
    const rows = scan.pages.map((page) =>
      [
        page.url,
        page.normalizedUrl,
        page.path,
        page.parentUrl,
        page.httpStatus,
        page.finalUrl,
        page.title,
        page.hasMetaDescription,
        page.h1Count,
        page.internalLinkCount,
        page.externalLinkCount,
        page.imageCount,
        page.documentLinkCount,
        page.wordCount,
        page.contentHash,
        page.crawlError
      ]
        .map(escapeCsv)
        .join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  }

  getSitemap(id: string): string | null {
    return this.getScan(id)?.mermaidSitemap ?? null;
  }

  compareScan(id: string): ScanComparison | null {
    const scanIndex = this.scans.findIndex((scan) => scan.id === id);

    if (scanIndex === -1) {
      return null;
    }

    const currentScan = this.scans[scanIndex];
    const previousScan = this.scans
      .slice(scanIndex + 1)
      .find((scan) => scan.origin === currentScan.origin) ?? null;
    const currentUrls = new Set(currentScan.pages.map((page) => page.normalizedUrl));
    const previousUrls = new Set(previousScan?.pages.map((page) => page.normalizedUrl) ?? []);

    return {
      scanId: currentScan.id,
      previousScanId: previousScan?.id ?? null,
      addedUrls: [...currentUrls].filter((url) => !previousUrls.has(url)),
      removedUrls: [...previousUrls].filter((url) => !currentUrls.has(url)),
      changedUrls: previousScan ? [currentScan.rootUrl] : []
    };
  }
}
