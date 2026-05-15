import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { LoadedScannerConfig } from "../src/config/scannerConfig.js";
import { SqliteScanStore } from "../src/db/sqliteScanStore.js";
import type { CrawlResult } from "../src/crawler/types.js";
import { RealScanService } from "../src/services/scanService.js";
import type { ScanPage } from "../src/types/scan.js";

function createScannerConfig(overrides: Partial<LoadedScannerConfig> = {}): LoadedScannerConfig {
  return {
    allowedDomains: ["example.com"],
    crawlAllowedHostVariants: true,
    defaultMaxPages: 10,
    maxAllowedPages: 100,
    crawlDelayMs: 0,
    requestTimeoutMs: 15000,
    stripQueryStrings: true,
    respectRobotsTxt: true,
    userAgent: "Internal-SiteScanner/0.1",
    configPath: "/tmp/scanner.config.json",
    scanCreationAllowed: true,
    ...overrides
  };
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
    internalLinkCount: 1,
    externalLinkCount: 0,
    imageCount: 2,
    documentLinkCount: 1,
    wordCount: 100,
    contentHash: "hash-home",
    crawlError: null,
    ...overrides
  };
}

const tempDirectories: string[] = [];

function createTempDir() {
  const tempDir = mkdtempSync(path.join(process.cwd(), "tmp-scans-route-"));
  tempDirectories.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirectories.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("scan routes", () => {
  async function createTestApp(options: {
    crawlImpl?: (rootUrl: string) => Promise<CrawlResult>;
    scannerConfig?: LoadedScannerConfig;
  } = {}) {
    const tempDir = createTempDir();
    let nowTick = 0;
    const scannerConfig = options.scannerConfig ?? createScannerConfig();
    const store = new SqliteScanStore({
      databasePath: path.join(tempDir, "store.sqlite")
    });
    const crawler = {
      crawl: async ({ rootUrl }: { rootUrl: string }) => {
        if (options.crawlImpl) {
          return options.crawlImpl(rootUrl);
        }

        return {
          rootUrl,
          origin: new URL(rootUrl).origin,
          hostname: new URL(rootUrl).hostname,
          pages: [
            createPage({
              url: rootUrl,
              normalizedUrl: rootUrl,
              path: new URL(rootUrl).pathname || "/",
              finalUrl: rootUrl,
              contentHash: `hash-${rootUrl}`
            })
          ]
        };
      }
    };
    const scanService = new RealScanService({
      crawler: crawler as never,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, nowTick++)),
      store
    });
    const app = buildApp(
      { logger: false },
      {
        loadScannerConfig: () => scannerConfig,
        scanService
      }
    );

    await app.ready();

    return { app };
  }

  it("rejects scan creation when allowedDomains is empty", async () => {
    const { app } = await createTestApp({
      scannerConfig: createScannerConfig({
        allowedDomains: [],
        scanCreationAllowed: false
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Scan creation is disabled");
  });

  it("rejects scan creation when the domain is not allowlisted", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://not-example.com"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("not in allowedDomains");
  });

  it("rejects localhost and private URLs", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "http://127.0.0.1/private"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("private, local, or otherwise unsafe");
  });

  it("creates a real stored scan for a valid allowlisted URL", async () => {
    const { app } = await createTestApp({
      crawlImpl: async (rootUrl) => ({
        rootUrl,
        origin: "https://example.com",
        hostname: "example.com",
        pages: [
          createPage({
            url: rootUrl,
            normalizedUrl: rootUrl,
            path: "/path"
          }),
          createPage({
            url: "https://example.com/about",
            normalizedUrl: "https://example.com/about",
            path: "/about",
            parentUrl: rootUrl,
            title: "About",
            contentHash: "hash-about"
          })
        ]
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/path?query=1#section",
        maxPages: 2
      }
    });
    const payload = response.json();
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${payload.id}`
    });

    await app.close();

    expect(response.statusCode).toBe(201);
    expect(payload.id).toBeTypeOf("string");
    expect(payload.rootUrl).toBe("https://example.com/path");
    expect(payload.status).toBe("completed");
    expect(payload.mermaidSitemap).toBeUndefined();
    expect(payload.links).toEqual({
      compare: `/api/scans/${payload.id}/compare`,
      csv: `/api/scans/${payload.id}/pages.csv`,
      details: `/api/scans/${payload.id}`,
      sitemap: `/api/scans/${payload.id}/sitemap.mmd`
    });
    expect(detailResponse.json().pages).toHaveLength(2);
  });

  it("accepts a scan URL without a protocol and normalizes it to https", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "example.com"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().rootUrl).toBe("https://example.com/");
  });

  it("list scans reads from storage", async () => {
    const { app } = await createTestApp();

    await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/list"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/scans"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBe(1);
    expect(response.json().items[0].status).toBe("completed");
  });

  it("csv endpoint uses stored page data", async () => {
    const { app } = await createTestApp({
      crawlImpl: async (rootUrl) => ({
        rootUrl,
        origin: "https://example.com",
        hostname: "example.com",
        pages: [
          createPage({
            url: rootUrl,
            normalizedUrl: rootUrl,
            title: 'Hello, "World"',
            crawlError: "Page issue"
          })
        ]
      })
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/csv"
      }
    });
    const scan = createResponse.json();
    const response = await app.inject({
      method: "GET",
      url: `/api/scans/${scan.id}/pages.csv`
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.body).toContain("URL,status,title,path");
    expect(response.body).toContain('"Hello, ""World"""');
  });

  it("mermaid endpoint uses stored page data", async () => {
    const { app } = await createTestApp({
      crawlImpl: async (rootUrl) => ({
        rootUrl,
        origin: "https://example.com",
        hostname: "example.com",
        pages: [
          createPage({
            url: rootUrl,
            normalizedUrl: rootUrl,
            path: "/"
          }),
          createPage({
            url: "https://example.com/about",
            normalizedUrl: "https://example.com/about",
            path: '/say-"hello"',
            parentUrl: rootUrl,
            contentHash: "hash-about"
          })
        ]
      })
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/map"
      }
    });
    const scan = createResponse.json();
    const response = await app.inject({
      method: "GET",
      url: `/api/scans/${scan.id}/sitemap.mmd`
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("flowchart TD");
    expect(response.body).toContain("/say-'hello'");
  });

  it("compare endpoint compares against the previous stored scan", async () => {
    let callCount = 0;
    const { app } = await createTestApp({
      crawlImpl: async (rootUrl) => {
        callCount += 1;

        return {
          rootUrl,
          origin: "https://example.com",
          hostname: "example.com",
          pages: callCount === 1
            ? [
                createPage({
                  url: rootUrl,
                  normalizedUrl: rootUrl,
                  contentHash: "hash-v1"
                })
              ]
            : [
                createPage({
                  url: rootUrl,
                  normalizedUrl: rootUrl,
                  contentHash: "hash-v2"
                }),
                createPage({
                  url: "https://example.com/new",
                  normalizedUrl: "https://example.com/new",
                  path: "/new",
                  parentUrl: rootUrl,
                  contentHash: "hash-new"
                })
              ]
        };
      }
    });

    await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/"
      }
    });
    const secondCreateResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/"
      }
    });
    const secondScan = secondCreateResponse.json();
    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${secondScan.id}/compare`
    });

    await app.close();

    expect(compareResponse.statusCode).toBe(200);
    expect(compareResponse.json().addedUrls).toContain("https://example.com/new");
    expect(compareResponse.json().changedUrls).toContain("https://example.com/");
  });

  it("failed scans are represented safely", async () => {
    const { app } = await createTestApp({
      crawlImpl: async () => {
        throw new Error("Request timed out");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/fail"
      }
    });
    const failedId = response.json().scanId;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${failedId}`
    });

    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("Request timed out");
    expect(response.json().message).not.toContain("at ");
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().status).toBe("failed");
    expect(detailResponse.json().errorMessage).toBe("Request timed out");
  });

  it("returns 404 for a missing scan id", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/scans/missing-scan"
    });

    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("Scan not found");
  });
});
