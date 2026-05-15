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

describe("loadScannerConfig", () => {
  it("loads config from an explicit path", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "custom-scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: ["example.com"],
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: false,
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
    expect(config.scanCreationAllowed).toBe(false);
  });

  it("rejects invalid config at load time", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: "example.com",
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: true,
        userAgent: "Test-Agent/1.0"
      })
    );

    expect(() =>
      loadScannerConfig({
        cwd: tempDir,
        env: {}
      })
    ).toThrow("allowedDomains must be an array of strings");
  });

  it("allows empty allowedDomains but marks scan creation as unsafe", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "scanner.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        allowedDomains: [],
        defaultMaxPages: 100,
        maxAllowedPages: 200,
        crawlDelayMs: 250,
        requestTimeoutMs: 5000,
        stripQueryStrings: true,
        respectRobotsTxt: true,
        userAgent: "Test-Agent/1.0"
      })
    );

    const config = loadScannerConfig({
      cwd: tempDir,
      env: {}
    });

    expect(config.allowedDomains).toEqual([]);
    expect(config.configPath).toBe(configPath);
    expect(config.scanCreationAllowed).toBe(false);
  });
});
