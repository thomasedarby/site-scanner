import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadScannerConfig } from "../src/config/scannerConfig.js";

const tempDirectories: string[] = [];

function createTempDir(): string {
  const tempDir = mkdtempSync(path.join(process.cwd(), "tmp-scanner-config-"));
  tempDirectories.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirectories.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function writeScannerConfig(tempDir: string, allowedDomains: unknown) {
  const configPath = path.join(tempDir, "scanner.config.json");

  writeFileSync(
    configPath,
    JSON.stringify({
      allowedDomains,
      crawlAllowedHostVariants: true,
      defaultMaxPages: 100,
      maxAllowedPages: 200,
      crawlDelayMs: 250,
      requestTimeoutMs: 5000,
      stripQueryStrings: true,
      respectRobotsTxt: true,
      sites: [],
      userAgent: "Test-Agent/1.0"
    })
  );

  return configPath;
}

describe("loadScannerConfig", () => {
  it("loads config from an explicit path", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "custom-scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: ["example.com"],
        crawlAllowedHostVariants: true,
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: false,
        sites: [],
        userAgent: "Test-Agent/1.0"
      })
    );

    const config = loadScannerConfig({
      cwd: tempDir,
      env: {
        SCANNER_CONFIG_PATH: configPath
      }
    });

    expect(config.configPath).toBe(configPath);
    expect(config.allowedDomains).toEqual(["example.com"]);
    expect(config.crawlAllowedHostVariants).toBe(true);
    expect(config.scanCreationAllowed).toBe(true);
  });

  it("falls back safely when no config file exists", () => {
    const tempDir = createTempDir();

    const config = loadScannerConfig({
      cwd: tempDir,
      env: {}
    });

    expect(config.configPath).toBeNull();
    expect(config.allowedDomains).toEqual([]);
    expect(config.defaultMaxPages).toBe(500);
    expect(config.maxAllowedPages).toBe(2000);
    expect(config.crawlAllowedHostVariants).toBe(true);
    expect(config.scanCreationAllowed).toBe(false);
  });

  it("rejects invalid config at load time", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, "example.com");

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains must be an array of strings");
  });

  it("allows empty allowedDomains but marks scan creation as unsafe", () => {
    const tempDir = createTempDir();
    const configPath = writeScannerConfig(tempDir, []);

    const config = loadScannerConfig({
      cwd: tempDir,
      env: {}
    });

    expect(config.allowedDomains).toEqual([]);
    expect(config.configPath).toBe(configPath);
    expect(config.scanCreationAllowed).toBe(false);
  });

  it("rejects a non-boolean crawlAllowedHostVariants value", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: ["example.com"],
        crawlAllowedHostVariants: "yes",
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: true,
        sites: [],
        userAgent: "Test-Agent/1.0"
      })
    );

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("crawlAllowedHostVariants must be a boolean");
  });

  it("accepts valid public domains and normalizes them", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, [
      "travelderbyshire.co.uk",
      "WWW.TRAVELDERBYSHIRE.CO.UK",
      "sub.example.org"
    ]);

    const config = loadScannerConfig({
      cwd: tempDir,
      env: {}
    });

    expect(config.allowedDomains).toEqual([
      "travelderbyshire.co.uk",
      "www.travelderbyshire.co.uk",
      "sub.example.org"
    ]);
  });

  it("trims whitespace around domains", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["  Example.org  "]);

    const config = loadScannerConfig({
      cwd: tempDir,
      env: {}
    });

    expect(config.allowedDomains).toEqual(["example.org"]);
  });

  it("rejects duplicate domains after normalization", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["Example.org", " example.org "]);

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains must not contain duplicates after normalization");
  });

  it("rejects full URLs", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["https://example.org"]);

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains[0] must be a plain hostname without URL parts");
  });

  it("rejects domains with paths", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["example.org/path"]);

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains[0] must be a plain hostname without URL parts");
  });

  it("rejects domains with ports", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["example.org:8080"]);

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains[0] must not include a port or colon");
  });

  it("rejects localhost", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["localhost"]);

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains[0] must not be localhost or a private/local address");
  });

  it("rejects private IP addresses", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["192.168.1.10"]);

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains[0] must not be localhost or a private/local address");
  });

  it("rejects empty string entries", () => {
    const tempDir = createTempDir();
    writeScannerConfig(tempDir, ["   "]);

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains[0] must not be empty");
  });

  it("accepts configured sites with a valid path boundary", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: ["observatory.derbyshire.gov.uk", "www.observatory.derbyshire.gov.uk"],
        crawlAllowedHostVariants: true,
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: true,
        sites: [
          {
            name: "JSNA",
            url: "https://observatory.derbyshire.gov.uk/jsna/",
            pathBoundary: "/jsna"
          }
        ],
        userAgent: "Test-Agent/1.0"
      })
    );

    const config = loadScannerConfig({
      cwd: tempDir,
      env: {}
    });

    expect(config.sites).toEqual([
      {
        name: "JSNA",
        url: "https://observatory.derbyshire.gov.uk/jsna/",
        pathBoundary: "/jsna/"
      }
    ]);
  });

  it("rejects an invalid configured site path boundary", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: ["observatory.derbyshire.gov.uk"],
        crawlAllowedHostVariants: true,
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: true,
        sites: [
          {
            name: "Bad boundary",
            url: "https://observatory.derbyshire.gov.uk/jsna/",
            pathBoundary: "https://observatory.derbyshire.gov.uk/jsna/"
          }
        ],
        userAgent: "Test-Agent/1.0"
      })
    );

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("pathBoundary must be a path only");
  });

  it("rejects configured site URLs whose hostname is not allowlisted", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: ["observatory.derbyshire.gov.uk"],
        crawlAllowedHostVariants: true,
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: true,
        sites: [
          {
            name: "Wrong host",
            url: "https://www.observatory.derbyshire.gov.uk/jsna/",
            pathBoundary: "/jsna/"
          }
        ],
        userAgent: "Test-Agent/1.0"
      })
    );

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("sites[0].url hostname must be present in allowedDomains");
  });
});
