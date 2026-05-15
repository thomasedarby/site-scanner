import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteScanStore } from "../src/db/sqliteScanStore.js";
import type { ScanPage, ScanRecord } from "../src/types/scan.js";

const tempDirectories: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(path.join(process.cwd(), "tmp-sqlite-store-"));
  tempDirectories.push(tempDir);
  return tempDir;
}

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

function createScan(id: string, overrides: Partial<ScanRecord> = {}): ScanRecord {
  const pages = overrides.pages ?? [createPage()];

  return {
    id,
    rootUrl: "https://example.com/",
    origin: "https://example.com",
    hostname: "example.com",
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:00:01.000Z",
    status: "completed",
    totalPagesCrawled: pages.length,
    totalImagesFound: pages.reduce((sum, page) => sum + page.imageCount, 0),
    totalDocumentsLinked: pages.reduce((sum, page) => sum + page.documentLinkCount, 0),
    brokenInternalLinks: 0,
    pagesMissingTitle: pages.filter((page) => page.title.length === 0).length,
    pagesMissingMetaDescription: pages.filter((page) => !page.hasMetaDescription).length,
    pagesWithNoH1: pages.filter((page) => page.h1Count === 0).length,
    mermaidSitemap: "flowchart TD",
    errorMessage: null,
    pages,
    ...overrides
  };
}

afterEach(() => {
  for (const tempDir of tempDirectories.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("SqliteScanStore", () => {
  it("initializes the database and creates tables", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });

    await store.initialize();
    await store.close();

    expect(existsSync(path.join(tempDir, "store.sqlite"))).toBe(true);
    expect(readdirSync(tempDir)).toContain("store.sqlite");
  });

  it("creates and saves a completed scan with pages", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });
    const scan = createScan("scan-1", {
      pages: [
        createPage(),
        createPage({
          url: "https://example.com/about",
          normalizedUrl: "https://example.com/about",
          path: "/about",
          parentUrl: "https://example.com/",
          title: "About"
        })
      ]
    });

    await store.initialize();
    await store.saveScan(scan);

    const savedScan = await store.getScanById("scan-1");

    await store.close();

    expect(savedScan?.id).toBe("scan-1");
    expect(savedScan?.pages).toHaveLength(2);
    expect(savedScan?.status).toBe("completed");
  });

  it("gets a scan by id", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });

    await store.initialize();
    await store.saveScan(createScan("scan-1"));

    const scan = await store.getScanById("scan-1");

    await store.close();

    expect(scan?.rootUrl).toBe("https://example.com/");
    expect(scan?.pages[0].url).toBe("https://example.com/");
  });

  it("lists scans newest first", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });

    await store.initialize();
    await store.saveScan(
      createScan("scan-older", {
        endTime: "2026-01-01T00:00:01.000Z"
      })
    );
    await store.saveScan(
      createScan("scan-newer", {
        endTime: "2026-01-02T00:00:01.000Z"
      })
    );

    const scans = await store.listScans();

    await store.close();

    expect(scans.map((scan) => scan.id)).toEqual(["scan-newer", "scan-older"]);
  });

  it("gets the previous completed scan for the same origin", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });

    await store.initialize();
    await store.saveScan(
      createScan("scan-old", {
        endTime: "2026-01-01T00:00:01.000Z"
      })
    );
    await store.saveScan(
      createScan("scan-other-origin", {
        origin: "https://other.example.com",
        hostname: "other.example.com",
        rootUrl: "https://other.example.com/",
        endTime: "2026-01-02T00:00:01.000Z"
      })
    );
    await store.saveScan(
      createScan("scan-current", {
        endTime: "2026-01-03T00:00:01.000Z"
      })
    );

    const previous = await store.getPreviousCompletedScan(
      "https://example.com",
      "2026-01-03T00:00:01.000Z",
      "scan-current"
    );

    await store.close();

    expect(previous?.id).toBe("scan-old");
  });

  it("returns null for a missing scan", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });

    await store.initialize();

    const scan = await store.getScanById("missing");

    await store.close();

    expect(scan).toBeNull();
  });

  it("preserves page fields when reloading a scan", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });
    const page = createPage({
      url: "https://example.com/report",
      normalizedUrl: "https://example.com/report",
      path: "/report",
      parentUrl: "https://example.com/",
      httpStatus: 503,
      finalUrl: "https://example.com/report",
      title: "",
      hasMetaDescription: false,
      h1Count: 0,
      internalLinkCount: 4,
      externalLinkCount: 2,
      imageCount: 5,
      documentLinkCount: 6,
      wordCount: 777,
      contentHash: "hash-report",
      crawlError: "Timeout"
    });

    await store.initialize();
    await store.saveScan(
      createScan("scan-1", {
        pages: [page]
      })
    );

    const savedScan = await store.getScanById("scan-1");

    await store.close();

    expect(savedScan?.pages[0]).toEqual(page);
  });

  it("replaces an incomplete scan safely by reusing the same id", async () => {
    const tempDir = createTempDir();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });

    await store.initialize();
    await store.saveScan(
      createScan("scan-1", {
        status: "running",
        pages: [createPage({ title: "Partial" })]
      })
    );
    await store.saveScan(
      createScan("scan-1", {
        status: "completed",
        pages: [createPage({ title: "Complete" })]
      })
    );

    const scan = await store.getScanById("scan-1");

    await store.close();

    expect(scan?.status).toBe("completed");
    expect(scan?.pages).toHaveLength(1);
    expect(scan?.pages[0].title).toBe("Complete");
  });
});
