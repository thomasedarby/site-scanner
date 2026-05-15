import { describe, expect, it } from "vitest";

import { compareScans, generateMermaidFlowchart, generatePagesCsv } from "../src/reports/reportUtils.js";
import type { ScanPage, ScanRecord } from "../src/types/scan.js";

function createPage(overrides: Partial<ScanPage> = {}): ScanPage {
  return {
    url: "https://example.com/",
    normalizedUrl: "https://example.com/",
    path: "/",
    parentUrl: null,
    httpStatus: 200,
    finalUrl: "https://example.com/",
    title: "Home",
    hasMetaDescription: true,
    h1Count: 1,
    internalLinkCount: 2,
    externalLinkCount: 1,
    imageCount: 3,
    documentLinkCount: 1,
    wordCount: 250,
    contentHash: "hash-home",
    crawlError: null,
    ...overrides
  };
}

function createScan(id: string, pages: ScanPage[]): ScanRecord {
  return {
    id,
    rootUrl: "https://example.com/",
    origin: "https://example.com",
    hostname: "example.com",
    pathBoundary: null,
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:00:01.000Z",
    status: "completed",
    totalPagesCrawled: pages.length,
    totalImagesFound: 0,
    totalDocumentsLinked: 0,
    brokenInternalLinks: 0,
    pagesMissingTitle: 0,
    pagesMissingMetaDescription: 0,
    pagesWithNoH1: 0,
    mermaidSitemap: "",
    errorMessage: null,
    pages
  };
}

describe("generatePagesCsv", () => {
  it("includes the expected headers", () => {
    const csv = generatePagesCsv([createPage()]);

    expect(csv.split("\n")[0]).toBe(
      "URL,status,title,path,image count,document count,internal link count,external link count,word count,missing title,missing meta description,H1 count,crawl error"
    );
  });

  it("escapes csv values correctly", () => {
    const csv = generatePagesCsv([
      createPage({
        title: 'Hello, "World"',
        crawlError: "Line 1\nLine 2"
      })
    ]);

    expect(csv).toContain('"Hello, ""World"""');
    expect(csv).toContain('"Line 1');
  });
});

describe("generateMermaidFlowchart", () => {
  it("produces mermaid flowchart output", () => {
    const output = generateMermaidFlowchart([
      createPage(),
      createPage({
        url: "https://example.com/about",
        normalizedUrl: "https://example.com/about",
        path: "/about",
        parentUrl: "https://example.com/"
      })
    ]);

    expect(output).toContain("flowchart TD");
    expect(output).toContain("-->");
  });

  it("escapes labels safely", () => {
    const output = generateMermaidFlowchart([
      createPage({
        path: '/say-"hello"'
      })
    ]);

    expect(output).toContain(`/say-'hello'`);
  });

  it("avoids duplicate edges", () => {
    const output = generateMermaidFlowchart([
      createPage(),
      createPage({
        url: "https://example.com/about",
        normalizedUrl: "https://example.com/about",
        path: "/about",
        parentUrl: "https://example.com/"
      }),
      createPage({
        url: "https://example.com/about",
        normalizedUrl: "https://example.com/about",
        path: "/about",
        parentUrl: "https://example.com/"
      })
    ]);

    expect(output.match(/-->/g)?.length).toBe(1);
  });
});

describe("compareScans", () => {
  it("detects added pages", () => {
    const previous = createScan("scan-1", [createPage()]);
    const latest = createScan("scan-2", [
      createPage(),
      createPage({
        url: "https://example.com/new",
        normalizedUrl: "https://example.com/new",
        path: "/new",
        contentHash: "hash-new"
      })
    ]);

    const comparison = compareScans(latest, previous);

    expect(comparison.addedUrls).toEqual(["https://example.com/new"]);
    expect(comparison.summary?.addedPages).toBe(1);
  });

  it("detects removed pages", () => {
    const previous = createScan("scan-1", [
      createPage(),
      createPage({
        url: "https://example.com/old",
        normalizedUrl: "https://example.com/old",
        path: "/old",
        contentHash: "hash-old"
      })
    ]);
    const latest = createScan("scan-2", [createPage()]);

    const comparison = compareScans(latest, previous);

    expect(comparison.removedUrls).toEqual(["https://example.com/old"]);
    expect(comparison.summary?.removedPages).toBe(1);
  });

  it("detects changed content hashes", () => {
    const previous = createScan("scan-1", [createPage({ contentHash: "old-hash" })]);
    const latest = createScan("scan-2", [createPage({ contentHash: "new-hash" })]);

    const comparison = compareScans(latest, previous);

    expect(comparison.changedUrls).toEqual(["https://example.com/"]);
    expect(comparison.summary?.changedPages).toBe(1);
  });

  it("detects changed status codes", () => {
    const previous = createScan("scan-1", [createPage({ httpStatus: 200 })]);
    const latest = createScan("scan-2", [createPage({ httpStatus: 404 })]);

    const comparison = compareScans(latest, previous);

    expect(comparison.changedStatusUrls).toEqual(["https://example.com/"]);
    expect(comparison.summary?.changedStatusPages).toBe(1);
  });
});
