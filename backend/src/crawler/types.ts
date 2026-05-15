import type { ScanPage } from "../types/scan.js";

export interface CrawlConfig {
  allowedDomains: string[];
  crawlAllowedHostVariants: boolean;
  crawlDelayMs: number;
  maxPages: number;
  pathBoundary: string | null;
  requestTimeoutMs: number;
  stripQueryStrings: boolean;
  userAgent: string;
}

export interface CrawlRequest {
  rootUrl: string;
  config: CrawlConfig;
  onProgress?: (event: CrawlProgressEvent) => void | Promise<void>;
}

export interface CrawlResult {
  rootUrl: string;
  origin: string;
  hostname: string;
  pathBoundary: string | null;
  pages: ScanPage[];
}

export interface CrawlProgressEvent {
  type:
    | "scan_started"
    | "page_queued"
    | "page_started"
    | "page_finished"
    | "page_failed"
    | "page_skipped"
    | "scan_completed";
  crawledPages: number;
  currentUrl: string | null;
  maxPages: number;
  message: string;
  page?: ScanPage;
  queuedPages: number;
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
