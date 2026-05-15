import type { ScanPage } from "../types/scan.js";

export interface CrawlConfig {
  allowedDomains: string[];
  crawlAllowedHostVariants: boolean;
  crawlDelayMs: number;
  maxPages: number;
  requestTimeoutMs: number;
  stripQueryStrings: boolean;
  userAgent: string;
}

export interface CrawlRequest {
  rootUrl: string;
  config: CrawlConfig;
}

export interface CrawlResult {
  rootUrl: string;
  origin: string;
  hostname: string;
  pages: ScanPage[];
}

export interface FetchResponseLike {
  headers: {
    get(name: string): string | null;
  };
  status: number;
  text(): Promise<string>;
  url: string;
}

export type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
    redirect?: "follow" | "manual";
    signal?: AbortSignal;
  }
) => Promise<FetchResponseLike>;

export interface CrawlerDependencies {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}
