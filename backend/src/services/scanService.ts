import { randomUUID } from "node:crypto";

import { CrawlerService } from "../crawler/crawlerService.js";
import type { CrawlConfig } from "../crawler/types.js";
import { SqliteScanStore } from "../db/sqliteScanStore.js";
import { compareScans, generateMermaidFlowchart, generatePagesCsv } from "../reports/reportUtils.js";
import type { LoadedScannerConfig } from "../config/scannerConfig.js";
import type { CreateScanInput, ScanComparison, ScanPage, ScanRecord, ScanSummary } from "../types/scan.js";

export interface ScanService {
  close?(): Promise<void>;
  compareScan(id: string): Promise<ScanComparison | null>;
  createScan(input: CreateScanInput, config: LoadedScannerConfig): Promise<ScanSummary>;
  getPagesCsv(id: string): Promise<string | null>;
  getScan(id: string): Promise<ScanRecord | null>;
  getSitemap(id: string): Promise<string | null>;
  initialize?(): Promise<void>;
  listScans(): Promise<ScanSummary[]>;
}

export class ScanExecutionError extends Error {
  readonly scanId: string;

  constructor(scanId: string, message: string) {
    super(message);
    this.name = "ScanExecutionError";
    this.scanId = scanId;
  }
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

export interface RealScanServiceDependencies {
  crawler?: CrawlerService;
  now?: () => Date;
  store?: SqliteScanStore;
}

export class RealScanService implements ScanService {
  private readonly crawler: CrawlerService;
  private readonly now: () => Date;
  private readonly store: SqliteScanStore;

  constructor(dependencies: RealScanServiceDependencies = {}) {
    this.crawler = dependencies.crawler ?? new CrawlerService();
    this.now = dependencies.now ?? (() => new Date());
    this.store = dependencies.store ?? new SqliteScanStore();
  }

  async initialize() {
    await this.store.initialize();
  }

  async close() {
    await this.store.close();
  }

  async createScan(input: CreateScanInput, config: LoadedScannerConfig): Promise<ScanSummary> {
    const rootUrl = new URL(input.url);
    const scanId = randomUUID();
    const startTime = this.now().toISOString();
    const runningRecord = buildScanRecord({
      endTime: startTime,
      errorMessage: null,
      hostname: rootUrl.hostname,
      id: scanId,
      origin: rootUrl.origin,
      pages: [],
      rootUrl: rootUrl.toString(),
      startTime,
      status: "running"
    });

    await this.store.saveScan(runningRecord);

    try {
      const crawlConfig: CrawlConfig = {
        allowedDomains: config.allowedDomains,
        crawlAllowedHostVariants: config.crawlAllowedHostVariants,
        crawlDelayMs: config.crawlDelayMs,
        maxPages: Math.min(input.maxPages, config.maxAllowedPages),
        requestTimeoutMs: config.requestTimeoutMs,
        stripQueryStrings: config.stripQueryStrings,
        userAgent: config.userAgent
      };
      const crawlResult = await this.crawler.crawl({
        rootUrl: rootUrl.toString(),
        config: crawlConfig
      });
      const completedRecord = buildScanRecord({
        endTime: this.now().toISOString(),
        errorMessage: null,
        hostname: crawlResult.hostname,
        id: scanId,
        origin: crawlResult.origin,
        pages: crawlResult.pages,
        rootUrl: crawlResult.rootUrl,
        startTime,
        status: "completed"
      });

      await this.store.saveScan(completedRecord);

      return {
        ...toSummary(completedRecord),
        crawlDelayMs: config.crawlDelayMs,
        maxPageLimitReached: completedRecord.totalPagesCrawled >= input.maxPages,
        maxPagesRequested: input.maxPages,
        userAgent: config.userAgent
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scan failed";
      const failedRecord = buildScanRecord({
        endTime: this.now().toISOString(),
        errorMessage: message,
        hostname: rootUrl.hostname,
        id: scanId,
        origin: rootUrl.origin,
        pages: [],
        rootUrl: rootUrl.toString(),
        startTime,
        status: "failed"
      });

      await this.store.saveScan(failedRecord);
      throw new ScanExecutionError(scanId, message);
    }
  }

  async listScans() {
    return this.store.listScans();
  }

  async getScan(id: string) {
    return this.store.getScanById(id);
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

    const previousScan = await this.store.getPreviousCompletedScan(scan.origin, scan.endTime, scan.id);
    return compareScans(scan, previousScan);
  }
}
