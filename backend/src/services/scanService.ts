import { randomUUID } from "node:crypto";

import { CrawlerService } from "../crawler/crawlerService.js";
import type { CrawlConfig, CrawlProgressEvent } from "../crawler/types.js";
import { SqliteScanStore } from "../db/sqliteScanStore.js";
import { compareScans, generateMermaidFlowchart, generatePagesCsv } from "../reports/reportUtils.js";
import type { LoadedScannerConfig } from "../config/scannerConfig.js";
import type {
  CreateScanInput,
  ScanComparison,
  ScanPage,
  ScanRecord,
  ScanStatus,
  ScanSummary
} from "../types/scan.js";

export interface ScanService {
  close?(): Promise<void>;
  compareScan(id: string): Promise<ScanComparison | null>;
  createScan(input: CreateScanInput, config: LoadedScannerConfig): Promise<ScanSummary>;
  deleteScan(id: string): Promise<"running" | { id: string } | null>;
  getPagesCsv(id: string): Promise<string | null>;
  getScan(id: string): Promise<ScanRecord | null>;
  getScanStatus(id: string): Promise<ScanStatus | null>;
  getSitemap(id: string): Promise<string | null>;
  initialize?(): Promise<void>;
  listScans(): Promise<ScanSummary[]>;
}

interface RunningScanState {
  currentUrl: string | null;
  finishedAt: string | null;
  id: string;
  maxPages: number;
  message: string;
  pages: ScanPage[];
  pagesQueued: number;
  startedAt: string;
  status: ScanStatus["status"];
  updatedAt: string;
}

function summarisePages(pages: ScanPage[]) {
  return {
    brokenInternalLinks: pages.filter(
      (page) => page.httpStatus >= 400 && page.parentUrl !== null
    ).length,
    pagesMissingMetaDescription: pages.filter((page) => !page.hasMetaDescription).length,
    pagesMissingTitle: pages.filter((page) => page.title.trim().length === 0).length,
    pagesWithNoH1: pages.filter((page) => page.h1Count === 0).length,
    totalDocumentsLinked: pages.reduce((sum, page) => sum + page.documentLinkCount, 0),
    totalImagesFound: pages.reduce((sum, page) => sum + page.imageCount, 0)
  };
}

function buildScanRecord(input: {
  endTime: string;
  errorMessage: string | null;
  hostname: string;
  id: string;
  origin: string;
  pathBoundary: string | null;
  pages: ScanPage[];
  rootUrl: string;
  startTime: string;
  status: ScanSummary["status"];
}): ScanRecord {
  const pageSummary = summarisePages(input.pages);

  return {
    id: input.id,
    rootUrl: input.rootUrl,
    origin: input.origin,
    hostname: input.hostname,
    pathBoundary: input.pathBoundary,
    startTime: input.startTime,
    endTime: input.endTime,
    status: input.status,
    totalPagesCrawled: input.pages.length,
    totalImagesFound: pageSummary.totalImagesFound,
    totalDocumentsLinked: pageSummary.totalDocumentsLinked,
    brokenInternalLinks: pageSummary.brokenInternalLinks,
    pagesMissingTitle: pageSummary.pagesMissingTitle,
    pagesMissingMetaDescription: pageSummary.pagesMissingMetaDescription,
    pagesWithNoH1: pageSummary.pagesWithNoH1,
    mermaidSitemap: generateMermaidFlowchart(input.pages),
    errorMessage: input.errorMessage,
    pages: input.pages
  };
}

function toSummary(scan: ScanRecord): ScanSummary {
  const { pages: _pages, ...summary } = scan;
  return summary;
}

function buildStatus(input: RunningScanState): ScanStatus {
  const progressPercent = input.status === "completed"
    ? 100
    : input.status === "failed"
      ? null
      : input.maxPages > 0
        ? Math.min(95, Math.round((input.pages.length / input.maxPages) * 100))
        : null;

  return {
    id: input.id,
    status: input.status,
    totalPagesCrawled: input.pages.length,
    pagesQueued: input.pagesQueued,
    maxPages: input.maxPages,
    progressPercent,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    finishedAt: input.finishedAt,
    currentUrl: input.currentUrl,
    message: input.message
  };
}

function buildCompletedStatus(scan: ScanRecord, maxPages: number | null, message: string): ScanStatus {
  return {
    id: scan.id,
    status: scan.status,
    totalPagesCrawled: scan.totalPagesCrawled,
    pagesQueued: 0,
    maxPages,
    progressPercent: scan.status === "completed" ? 100 : null,
    startedAt: scan.startTime,
    updatedAt: scan.endTime,
    finishedAt: scan.endTime,
    currentUrl: null,
    message
  };
}

function buildInitialSummary(input: {
  config: LoadedScannerConfig;
  id: string;
  pathBoundary: string | null;
  rootUrl: URL;
  startTime: string;
  status: ScanSummary["status"];
}): ScanSummary {
  return {
    id: input.id,
    rootUrl: input.rootUrl.toString(),
    origin: input.rootUrl.origin,
    hostname: input.rootUrl.hostname,
    pathBoundary: input.pathBoundary,
    startTime: input.startTime,
    endTime: input.startTime,
    status: input.status,
    totalPagesCrawled: 0,
    totalImagesFound: 0,
    totalDocumentsLinked: 0,
    brokenInternalLinks: 0,
    pagesMissingTitle: 0,
    pagesMissingMetaDescription: 0,
    pagesWithNoH1: 0,
    mermaidSitemap: generateMermaidFlowchart([]),
    errorMessage: null,
    crawlDelayMs: input.config.crawlDelayMs,
    maxPageLimitReached: false,
    maxPagesRequested: input.config.defaultMaxPages,
    userAgent: input.config.userAgent
  };
}

export interface RealScanServiceDependencies {
  crawler?: CrawlerService;
  now?: () => Date;
  store?: SqliteScanStore;
}

export class RealScanService implements ScanService {
  private readonly crawler: CrawlerService;
  private readonly now: () => Date;
  private readonly store: SqliteScanStore;
  private readonly runningScans = new Map<string, RunningScanState>();

  constructor(dependencies: RealScanServiceDependencies = {}) {
    this.crawler = dependencies.crawler ?? new CrawlerService();
    this.now = dependencies.now ?? (() => new Date());
    this.store = dependencies.store ?? new SqliteScanStore();
  }

  async initialize() {
    await this.store.initialize();
    await this.store.markInProgressScansFailed("Scan was interrupted before completion");
  }

  async close() {
    await this.store.close();
  }

  private setRunningScanState(nextState: RunningScanState) {
    this.runningScans.set(nextState.id, nextState);
  }

  private updateRunningScanState(
    scanId: string,
    update: Partial<RunningScanState>
  ): RunningScanState | null {
    const existing = this.runningScans.get(scanId);

    if (!existing) {
      return null;
    }

    const nextState: RunningScanState = {
      ...existing,
      ...update
    };

    this.setRunningScanState(nextState);
    return nextState;
  }

  private async persistPartialRecord(input: {
    errorMessage: string | null;
    origin: string;
    pathBoundary: string | null;
    rootUrl: string;
    runningState: RunningScanState;
  }) {
    const record = buildScanRecord({
      endTime: input.runningState.updatedAt,
      errorMessage: input.errorMessage,
      hostname: new URL(input.rootUrl).hostname,
      id: input.runningState.id,
      origin: input.origin,
      pathBoundary: input.pathBoundary,
      pages: input.runningState.pages,
      rootUrl: input.rootUrl,
      startTime: input.runningState.startedAt,
      status: input.runningState.status
    });

    await this.store.saveScan(record);
  }

  private async runScanInBackground(
    scanId: string,
    input: CreateScanInput,
    config: LoadedScannerConfig,
    startTime: string
  ) {
    const rootUrl = new URL(input.url);
    const pathBoundary = input.pathBoundary ?? null;

    try {
      this.updateRunningScanState(scanId, {
        message: "Scan is running",
        status: "running",
        updatedAt: this.now().toISOString()
      });
      await this.persistPartialRecord({
        errorMessage: null,
        origin: rootUrl.origin,
        pathBoundary,
        rootUrl: rootUrl.toString(),
        runningState: this.runningScans.get(scanId)!
      });

      const crawlConfig: CrawlConfig = {
        allowedDomains: config.allowedDomains,
        crawlAllowedHostVariants: config.crawlAllowedHostVariants,
        crawlDelayMs: config.crawlDelayMs,
        maxPages: Math.min(input.maxPages, config.maxAllowedPages),
        pathBoundary,
        requestTimeoutMs: config.requestTimeoutMs,
        stripQueryStrings: config.stripQueryStrings,
        userAgent: config.userAgent
      };

      const crawlResult = await this.crawler.crawl({
        rootUrl: rootUrl.toString(),
        config: crawlConfig,
        onProgress: async (event: CrawlProgressEvent) => {
          const updatedAt = this.now().toISOString();
          const existing = this.runningScans.get(scanId);

          if (!existing) {
            return;
          }

          const nextPages = event.page
            ? [...existing.pages, event.page]
            : existing.pages;
          const nextState: RunningScanState = {
            ...existing,
            currentUrl: event.currentUrl,
            message: event.message,
            pages: nextPages,
            pagesQueued: event.queuedPages,
            status: event.type === "scan_started" ? "running" : existing.status,
            updatedAt
          };

          this.runningScans.set(scanId, nextState);

          if (event.type === "page_finished" || event.type === "page_failed") {
            await this.persistPartialRecord({
              errorMessage: null,
              origin: rootUrl.origin,
              pathBoundary,
              rootUrl: rootUrl.toString(),
              runningState: nextState
            });
          }
        }
      });

      const endTime = this.now().toISOString();
      const completedRecord = buildScanRecord({
        endTime,
        errorMessage: null,
        hostname: crawlResult.hostname,
        id: scanId,
        origin: crawlResult.origin,
        pathBoundary: crawlResult.pathBoundary,
        pages: crawlResult.pages,
        rootUrl: crawlResult.rootUrl,
        startTime,
        status: "completed"
      });

      await this.store.saveScan(completedRecord);
      this.setRunningScanState({
        currentUrl: null,
        finishedAt: endTime,
        id: scanId,
        maxPages: Math.min(input.maxPages, config.maxAllowedPages),
        message: "Scan completed",
        pages: crawlResult.pages,
        pagesQueued: 0,
        startedAt: startTime,
        status: "completed",
        updatedAt: endTime
      });
    } catch (error) {
      const endTime = this.now().toISOString();
      const message = error instanceof Error ? error.message : "Scan failed";
      const failedPages = this.runningScans.get(scanId)?.pages ?? [];
      const failedRecord = buildScanRecord({
        endTime,
        errorMessage: message,
        hostname: rootUrl.hostname,
        id: scanId,
        origin: rootUrl.origin,
        pathBoundary,
        pages: failedPages,
        rootUrl: rootUrl.toString(),
        startTime,
        status: "failed"
      });

      await this.store.saveScan(failedRecord);
      this.setRunningScanState({
        currentUrl: null,
        finishedAt: endTime,
        id: scanId,
        maxPages: Math.min(input.maxPages, config.maxAllowedPages),
        message,
        pages: failedPages,
        pagesQueued: 0,
        startedAt: startTime,
        status: "failed",
        updatedAt: endTime
      });
    }
  }

  async createScan(input: CreateScanInput, config: LoadedScannerConfig): Promise<ScanSummary> {
    const rootUrl = new URL(input.url);
    const scanId = randomUUID();
    const startTime = this.now().toISOString();
    const maxPages = Math.min(input.maxPages, config.maxAllowedPages);
    const queuedRecord = buildScanRecord({
      endTime: startTime,
      errorMessage: null,
      hostname: rootUrl.hostname,
      id: scanId,
      origin: rootUrl.origin,
      pathBoundary: input.pathBoundary ?? null,
      pages: [],
      rootUrl: rootUrl.toString(),
      startTime,
      status: "queued"
    });

    await this.store.saveScan(queuedRecord);
    this.runningScans.set(scanId, {
      currentUrl: null,
      finishedAt: null,
      id: scanId,
      maxPages,
      message: "Scan queued",
      pages: [],
      pagesQueued: 1,
      startedAt: startTime,
      status: "queued",
      updatedAt: startTime
    });

    void Promise.resolve().then(() =>
      this.runScanInBackground(
        scanId,
        { ...input, maxPages },
        config,
        startTime
      )
    );

    return {
      ...buildInitialSummary({
        config,
        id: scanId,
        pathBoundary: input.pathBoundary ?? null,
        rootUrl,
        startTime,
        status: "queued"
      }),
      maxPagesRequested: maxPages
    };
  }

  async listScans() {
    return this.store.listScans();
  }

  async getScan(id: string) {
    return this.store.getScanById(id);
  }

  async deleteScan(id: string) {
    const runningState = this.runningScans.get(id);

    if (runningState && (runningState.status === "queued" || runningState.status === "running")) {
      return "running";
    }

    const scan = await this.store.getScanById(id);

    if (!scan) {
      return null;
    }

    await this.store.deleteScan(id);
    this.runningScans.delete(id);

    return { id };
  }

  async getScanStatus(id: string) {
    const runningState = this.runningScans.get(id);

    if (runningState) {
      return buildStatus(runningState);
    }

    const scan = await this.store.getScanById(id);

    if (!scan) {
      return null;
    }

    const message = scan.status === "failed"
      ? scan.errorMessage || "Scan failed"
      : "Scan completed";

    return buildCompletedStatus(scan, null, message);
  }

  async getPagesCsv(id: string) {
    const scan = await this.store.getScanById(id);
    return scan ? generatePagesCsv(scan.pages) : null;
  }

  async getSitemap(id: string) {
    const scan = await this.store.getScanById(id);
    return scan ? generateMermaidFlowchart(scan.pages) : null;
  }

  async compareScan(id: string) {
    const scan = await this.store.getScanById(id);

    if (!scan) {
      return null;
    }

    const previousScan = await this.store.getPreviousCompletedScan(
      scan.origin,
      scan.endTime,
      scan.id,
      scan.pathBoundary
    );
    return compareScans(scan, previousScan);
  }
}
