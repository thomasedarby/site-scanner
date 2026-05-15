import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { CrawlResult } from "../src/crawler/types.js";
import type { LoadedScannerConfig } from "../src/config/scannerConfig.js";
import { SqliteScanStore } from "../src/db/sqliteScanStore.js";
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
    sites: [],
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

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function waitFor<T>(task: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await task();

    if (predicate(value)) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition");
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
          pathBoundary: null,
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

  it("returns quickly with queued status and status link", async () => {
    const deferred = deferredPromise<CrawlResult>();
    const { app } = await createTestApp({
      crawlImpl: async () => deferred.promise
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com"
      }
    });
    const payload = response.json();

    deferred.resolve({
      rootUrl: "https://example.com/",
      origin: "https://example.com",
      hostname: "example.com",
      pathBoundary: null,
      pages: [createPage()]
    });

    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${payload.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );

    await app.close();

    expect(response.statusCode).toBe(202);
    expect(payload.status).toBe("queued");
    expect(payload.links.status).toBe(`/api/scans/${payload.id}/status`);
  });

  it("returns live status for a running scan", async () => {
    const deferred = deferredPromise<CrawlResult>();
    const { app } = await createTestApp({
      crawlImpl: async () => deferred.promise
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com"
      }
    });
    const scan = createResponse.json();
    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${scan.id}/status`
    });

    deferred.resolve({
      rootUrl: "https://example.com/",
      origin: "https://example.com",
      hostname: "example.com",
      pathBoundary: null,
      pages: [createPage()]
    });

    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );

    await app.close();

    expect(statusResponse.statusCode).toBe(200);
    expect(["queued", "running"]).toContain(statusResponse.json().status);
  });

  it("returns completed status updates and final details", async () => {
    const { app } = await createTestApp({
      crawlImpl: async (rootUrl) => ({
        rootUrl,
        origin: "https://example.com",
        hostname: "example.com",
        pathBoundary: null,
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
    const finalStatus = await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${payload.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${payload.id}`
    });

    await app.close();

    expect(response.statusCode).toBe(202);
    expect(payload.pathBoundary).toBeNull();
    expect(payload.mermaidSitemap).toBeUndefined();
    expect(payload.links).toEqual({
      compare: `/api/scans/${payload.id}/compare`,
      csv: `/api/scans/${payload.id}/pages.csv`,
      details: `/api/scans/${payload.id}`,
      status: `/api/scans/${payload.id}/status`,
      sitemap: `/api/scans/${payload.id}/sitemap.mmd`
    });
    expect(finalStatus.status).toBe("completed");
    expect(detailResponse.json().pages).toHaveLength(2);
  });

  it("accepts a valid pathBoundary and persists it", async () => {
    const { app } = await createTestApp({
      crawlImpl: async (rootUrl) => ({
        rootUrl,
        origin: "https://example.com",
        hostname: "example.com",
        pathBoundary: "/jsna/",
        pages: [
          createPage({
            url: "https://example.com/jsna/",
            normalizedUrl: "https://example.com/jsna/",
            path: "/jsna"
          }),
          createPage({
            url: "https://example.com/jsna/page-one/",
            normalizedUrl: "https://example.com/jsna/page-one/",
            path: "/jsna/page-one/",
            parentUrl: "https://example.com/jsna/",
            contentHash: "hash-page-one"
          })
        ]
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/jsna/",
        maxPages: 10,
        pathBoundary: "/jsna"
      }
    });
    const payload = response.json();
    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${payload.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${payload.id}`
    });

    await app.close();

    expect(response.statusCode).toBe(202);
    expect(payload.pathBoundary).toBe("/jsna/");
    expect(detailResponse.json().pathBoundary).toBe("/jsna/");
    expect(detailResponse.json().pages).toHaveLength(2);
  });

  it("rejects a pathBoundary that does not contain the submitted URL path", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/jsna/",
        pathBoundary: "/about/"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("pathBoundary must contain the submitted URL path");
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
    const payload = response.json();

    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${payload.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );

    await app.close();

    expect(response.statusCode).toBe(202);
    expect(response.json().rootUrl).toBe("https://example.com/");
  });

  it("returns configured sites for the frontend", async () => {
    const { app } = await createTestApp({
      scannerConfig: createScannerConfig({
        sites: [
          {
            name: "JSNA",
            url: "https://observatory.derbyshire.gov.uk/jsna/",
            pathBoundary: "/jsna/"
          }
        ]
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/scanner-config"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().sites).toEqual([
      {
        name: "JSNA",
        url: "https://observatory.derbyshire.gov.uk/jsna/",
        pathBoundary: "/jsna/"
      }
    ]);
  });

  it("list scans reads from storage", async () => {
    const { app } = await createTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/list"
      }
    });
    const scan = createResponse.json();

    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/scans"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBe(1);
    expect(response.json().items[0].status).toBe("completed");
  });

  it("deletes a completed scan and removes it from the list", async () => {
    const { app } = await createTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/delete-me"
      }
    });
    const scan = createResponse.json();

    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/scans/${scan.id}`
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/scans"
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${scan.id}`
    });

    await app.close();

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({
      id: scan.id,
      message: "Scan deleted"
    });
    expect(listResponse.json().items).toEqual([]);
    expect(detailResponse.statusCode).toBe(404);
  });

  it("deletes a failed scan", async () => {
    const { app } = await createTestApp({
      crawlImpl: async () => {
        throw new Error("Upstream fetch failed");
      }
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/fails"
      }
    });
    const scan = createResponse.json();

    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "failed"
    );

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/scans/${scan.id}`
    });

    await app.close();

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json().message).toBe("Scan deleted");
  });

  it("returns 404 when deleting a missing scan", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "DELETE",
      url: "/api/scans/missing-scan"
    });

    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("Scan not found");
  });

  it("rejects deleting a running scan", async () => {
    const deferred = deferredPromise<CrawlResult>();
    const { app } = await createTestApp({
      crawlImpl: async () => deferred.promise
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/running"
      }
    });
    const scan = createResponse.json();

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/scans/${scan.id}`
    });

    deferred.resolve({
      rootUrl: "https://example.com/running",
      origin: "https://example.com",
      hostname: "example.com",
      pathBoundary: null,
      pages: [createPage({
        url: "https://example.com/running",
        normalizedUrl: "https://example.com/running",
        path: "/running",
        finalUrl: "https://example.com/running",
        contentHash: "hash-running"
      })]
    });

    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );

    await app.close();

    expect(deleteResponse.statusCode).toBe(409);
    expect(deleteResponse.json().message).toBe("Cannot delete a running scan");
  });

  it("csv endpoint uses stored page data", async () => {
    const { app } = await createTestApp({
      crawlImpl: async (rootUrl) => ({
        rootUrl,
        origin: "https://example.com",
        hostname: "example.com",
        pathBoundary: null,
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
    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );
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
        pathBoundary: null,
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
    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );
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
          pathBoundary: null,
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

    const firstCreateResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/"
      }
    });
    const firstScan = firstCreateResponse.json();
    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${firstScan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );

    const secondCreateResponse = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/"
      }
    });
    const secondScan = secondCreateResponse.json();
    await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${secondScan.id}/status`
        })).json(),
      (status) => status.status === "completed"
    );
    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${secondScan.id}/compare`
    });

    await app.close();

    expect(compareResponse.statusCode).toBe(200);
    expect(compareResponse.json().addedUrls).toContain("https://example.com/new");
    expect(compareResponse.json().changedUrls).toContain("https://example.com/");
  });

  it("failed scans are represented safely in status and details", async () => {
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
    const scan = response.json();
    const failedStatus = await waitFor(
      async () =>
        (await app.inject({
          method: "GET",
          url: `/api/scans/${scan.id}/status`
        })).json(),
      (status) => status.status === "failed"
    );
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/scans/${scan.id}`
    });

    await app.close();

    expect(response.statusCode).toBe(202);
    expect(failedStatus.message).toBe("Request timed out");
    expect(failedStatus.message).not.toContain("at ");
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().status).toBe("failed");
    expect(detailResponse.json().errorMessage).toBe("Request timed out");
  });

  it("returns 404 for a missing scan id", async () => {
    const { app } = await createTestApp();

    const detailResponse = await app.inject({
      method: "GET",
      url: "/api/scans/missing-scan"
    });
    const statusResponse = await app.inject({
      method: "GET",
      url: "/api/scans/missing-scan/status"
    });

    await app.close();

    expect(detailResponse.statusCode).toBe(404);
    expect(detailResponse.json().message).toBe("Scan not found");
    expect(statusResponse.statusCode).toBe(404);
  });
});
