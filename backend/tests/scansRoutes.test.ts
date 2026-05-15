import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { LoadedScannerConfig } from "../src/config/scannerConfig.js";
import { MockScanService } from "../src/services/mockScanService.js";

function createScannerConfig(overrides: Partial<LoadedScannerConfig> = {}): LoadedScannerConfig {
  return {
    allowedDomains: ["example.com"],
    defaultMaxPages: 10,
    maxAllowedPages: 100,
    crawlDelayMs: 500,
    requestTimeoutMs: 15000,
    stripQueryStrings: true,
    respectRobotsTxt: true,
    userAgent: "Internal-SiteScanner/0.1",
    configPath: "/tmp/scanner.config.json",
    scanCreationAllowed: true,
    ...overrides
  };
}

describe("scan routes", () => {
  const scanService = new MockScanService();
  let scannerConfig = createScannerConfig();
  const app = buildApp(
    { logger: false },
    {
      loadScannerConfig: () => scannerConfig,
      scanService
    }
  );

  beforeEach(() => {
    scannerConfig = createScannerConfig();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects scan creation when allowedDomains is empty", async () => {
    scannerConfig = createScannerConfig({
      allowedDomains: [],
      scanCreationAllowed: false
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Scan creation is disabled");
  });

  it("rejects scan creation when the domain is not allowlisted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://not-example.com"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("not in allowedDomains");
  });

  it("rejects localhost and private URLs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "http://127.0.0.1/private"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("private, local, or otherwise unsafe");
  });

  it("creates a mock scan for a valid allowlisted URL", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/scans",
      payload: {
        url: "https://example.com/path?query=1#section",
        maxPages: 2
      }
    });

    const payload = response.json();

    expect(response.statusCode).toBe(201);
    expect(payload.id).toBeTypeOf("string");
    expect(payload.rootUrl).toBe("https://example.com/path");
    expect(payload.status).toBe("completed");
    expect(payload.pages).toHaveLength(2);
  });

  it("lists scans", async () => {
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

    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThan(0);
  });

  it("returns csv content for an existing scan", async () => {
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

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.body).toContain("url,normalizedUrl,path");
  });

  it("returns mermaid text for an existing scan", async () => {
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

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("flowchart TD");
  });

  it("returns 404 for a missing scan id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/scans/missing-scan"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("Scan not found");
  });
});
