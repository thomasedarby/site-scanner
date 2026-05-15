import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isPrivateOrLocalHostname, normaliseUrl } from "../security/urlSafety.js";
import { isPathWithinBoundary, normalisePathBoundary } from "../security/pathBoundary.js";

export interface ConfiguredSite {
  name: string;
  pathBoundary: string | null;
  url: string;
}

export interface ScannerConfig {
  allowedDomains: string[];
  crawlAllowedHostVariants: boolean;
  defaultMaxPages: number;
  maxAllowedPages: number;
  crawlDelayMs: number;
  requestTimeoutMs: number;
  stripQueryStrings: boolean;
  respectRobotsTxt: boolean;
  sites: ConfiguredSite[];
  userAgent: string;
}

export interface LoadedScannerConfig extends ScannerConfig {
  configPath: string | null;
  scanCreationAllowed: boolean;
}

export interface LoadScannerConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  allowedDomains: [],
  crawlAllowedHostVariants: true,
  defaultMaxPages: 500,
  maxAllowedPages: 2000,
  crawlDelayMs: 500,
  requestTimeoutMs: 15000,
  stripQueryStrings: true,
  respectRobotsTxt: true,
  sites: [],
  userAgent: "Internal-SiteScanner/0.1"
};

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertInteger(name: string, value: unknown, minimum: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
}

function normaliseAllowedDomain(entry: string, index: number): string {
  const trimmedEntry = entry.trim();

  if (trimmedEntry.length === 0) {
    throw new Error(`allowedDomains[${index}] must not be empty`);
  }

  if (/\s/.test(trimmedEntry)) {
    throw new Error(`allowedDomains[${index}] must not contain whitespace`);
  }

  const lowerCaseEntry = trimmedEntry.toLowerCase();

  if (
    lowerCaseEntry.includes("://") ||
    lowerCaseEntry.includes("/") ||
    lowerCaseEntry.includes("?") ||
    lowerCaseEntry.includes("#") ||
    lowerCaseEntry.includes("@")
  ) {
    throw new Error(`allowedDomains[${index}] must be a plain hostname without URL parts`);
  }

  if (lowerCaseEntry.includes(":")) {
    throw new Error(`allowedDomains[${index}] must not include a port or colon`);
  }

  const isHostname = HOSTNAME_PATTERN.test(lowerCaseEntry);
  const isIpv4 = IPV4_PATTERN.test(lowerCaseEntry);

  if (!isHostname && !isIpv4) {
    throw new Error(`allowedDomains[${index}] must be a valid hostname`);
  }

  if (isPrivateOrLocalHostname(lowerCaseEntry)) {
    throw new Error(`allowedDomains[${index}] must not be localhost or a private/local address`);
  }

  return lowerCaseEntry;
}

function normaliseConfiguredSite(
  entry: unknown,
  index: number,
  allowedDomains: string[]
): ConfiguredSite {
  if (!isPlainObject(entry)) {
    throw new Error(`sites[${index}] must be an object`);
  }

  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const rawUrl = typeof entry.url === "string" ? entry.url.trim() : "";
  const rawPathBoundary = entry.pathBoundary;

  if (name.length === 0) {
    throw new Error(`sites[${index}].name must be a non-empty string`);
  }

  if (rawUrl.length === 0) {
    throw new Error(`sites[${index}].url must be a non-empty string`);
  }

  let normalizedUrl: URL;

  try {
    normalizedUrl = normaliseUrl(rawUrl);
  } catch (error) {
    throw new Error(
      `sites[${index}].url is invalid: ${error instanceof Error ? error.message : "Invalid URL"}`
    );
  }

  if (isPrivateOrLocalHostname(normalizedUrl.hostname)) {
    throw new Error(`sites[${index}].url must not use a private/local hostname`);
  }

  if (!allowedDomains.includes(normalizedUrl.hostname)) {
    throw new Error(`sites[${index}].url hostname must be present in allowedDomains`);
  }

  let pathBoundary: string | null = null;

  if (rawPathBoundary !== undefined && rawPathBoundary !== null) {
    if (typeof rawPathBoundary !== "string") {
      throw new Error(`sites[${index}].pathBoundary must be a string when provided`);
    }

    pathBoundary = normalisePathBoundary(rawPathBoundary);

    if (!isPathWithinBoundary(normalizedUrl.pathname, pathBoundary)) {
      throw new Error(`sites[${index}].pathBoundary must contain the site URL path`);
    }
  }

  return {
    name,
    pathBoundary,
    url: normalizedUrl.toString()
  };
}

function validateScannerConfigShape(config: unknown): ScannerConfig {
  if (!isPlainObject(config)) {
    throw new Error("scanner config must be a JSON object");
  }

  const {
    allowedDomains,
    crawlAllowedHostVariants,
    defaultMaxPages,
    maxAllowedPages,
    crawlDelayMs,
    requestTimeoutMs,
    stripQueryStrings,
    respectRobotsTxt,
    sites,
    userAgent
  } = config;

  if (!Array.isArray(allowedDomains) || !allowedDomains.every((value) => typeof value === "string")) {
    throw new Error("allowedDomains must be an array of strings");
  }

  const normalisedAllowedDomains = allowedDomains.map((value, index) =>
    normaliseAllowedDomain(value, index)
  );
  const uniqueAllowedDomains = new Set(normalisedAllowedDomains);

  if (uniqueAllowedDomains.size !== normalisedAllowedDomains.length) {
    throw new Error("allowedDomains must not contain duplicates after normalization");
  }

  if (typeof crawlAllowedHostVariants !== "boolean") {
    throw new Error("crawlAllowedHostVariants must be a boolean");
  }

  assertInteger("defaultMaxPages", defaultMaxPages, 1);
  assertInteger("maxAllowedPages", maxAllowedPages, 1);

  if (defaultMaxPages > maxAllowedPages) {
    throw new Error("defaultMaxPages must be less than or equal to maxAllowedPages");
  }

  assertInteger("crawlDelayMs", crawlDelayMs, 0);
  assertInteger("requestTimeoutMs", requestTimeoutMs, 1);

  if (typeof stripQueryStrings !== "boolean") {
    throw new Error("stripQueryStrings must be a boolean");
  }

  if (typeof respectRobotsTxt !== "boolean") {
    throw new Error("respectRobotsTxt must be a boolean");
  }

  if (sites !== undefined && (!Array.isArray(sites))) {
    throw new Error("sites must be an array when provided");
  }

  if (typeof userAgent !== "string" || userAgent.trim().length === 0) {
    throw new Error("userAgent must be a non-empty string");
  }

  const normalizedSites = (sites ?? []).map((site, index) =>
    normaliseConfiguredSite(site, index, normalisedAllowedDomains)
  );

  return {
    allowedDomains: normalisedAllowedDomains,
    crawlAllowedHostVariants,
    defaultMaxPages,
    maxAllowedPages,
    crawlDelayMs,
    requestTimeoutMs,
    stripQueryStrings,
    respectRobotsTxt,
    sites: normalizedSites,
    userAgent
  };
}

function resolveExplicitConfigPath(cwd: string, env: NodeJS.ProcessEnv): string | null {
  const configuredPath = env.SCANNER_CONFIG_PATH?.trim();

  if (!configuredPath) {
    return null;
  }

  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(cwd, configuredPath);
}

function resolveFallbackConfigPath(cwd: string): string | null {
  const candidates = [path.resolve(cwd, "scanner.config.json")];

  if (path.basename(cwd) === "backend") {
    candidates.push(path.resolve(cwd, "..", "scanner.config.json"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadScannerConfig(
  options: LoadScannerConfigOptions = {}
): LoadedScannerConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const explicitConfigPath = resolveExplicitConfigPath(cwd, env);
  const configPath = explicitConfigPath ?? resolveFallbackConfigPath(cwd);

  if (!configPath || !existsSync(configPath)) {
    return {
      ...DEFAULT_SCANNER_CONFIG,
      configPath: null,
      scanCreationAllowed: false
    };
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new Error(
      `Failed to read scanner config at ${configPath}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const validatedConfig = validateScannerConfigShape(parsedConfig);

  return {
    ...validatedConfig,
    configPath,
    scanCreationAllowed: validatedConfig.allowedDomains.length > 0
  };
}
