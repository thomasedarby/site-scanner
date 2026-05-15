import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ScanPage, ScanRecord, ScanSummary } from "../types/scan.js";

interface ScanPageRow {
  content_hash: string;
  crawl_error: string | null;
  document_link_count: number;
  external_link_count: number;
  final_url: string;
  h1_count: number;
  has_meta_description: number;
  http_status: number;
  image_count: number;
  internal_link_count: number;
  normalized_url: string;
  page_order: number;
  parent_url: string | null;
  path: string;
  scan_id: string;
  title: string;
  url: string;
  word_count: number;
}

interface ScanSummaryRow {
  broken_internal_links: number;
  end_time: string;
  error_message: string | null;
  hostname: string;
  id: string;
  mermaid_sitemap: string;
  origin: string;
  pages_missing_meta_description: number;
  pages_missing_title: number;
  pages_with_no_h1: number;
  root_url: string;
  start_time: string;
  status: ScanSummary["status"];
  total_documents_linked: number;
  total_images_found: number;
  total_pages_crawled: number;
}

export interface SqliteScanStoreOptions {
  cwd?: string;
  databasePath?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SqliteScanStoreInfo {
  dataDir: string;
  databasePath: string;
}

function mapSummaryRow(row: ScanSummaryRow): ScanSummary {
  return {
    id: row.id,
    rootUrl: row.root_url,
    origin: row.origin,
    hostname: row.hostname,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    totalPagesCrawled: row.total_pages_crawled,
    totalImagesFound: row.total_images_found,
    totalDocumentsLinked: row.total_documents_linked,
    brokenInternalLinks: row.broken_internal_links,
    pagesMissingTitle: row.pages_missing_title,
    pagesMissingMetaDescription: row.pages_missing_meta_description,
    pagesWithNoH1: row.pages_with_no_h1,
    mermaidSitemap: row.mermaid_sitemap,
    errorMessage: row.error_message
  };
}

function mapPageRow(row: ScanPageRow): ScanPage {
  return {
    url: row.url,
    normalizedUrl: row.normalized_url,
    path: row.path,
    parentUrl: row.parent_url,
    httpStatus: row.http_status,
    finalUrl: row.final_url,
    title: row.title,
    hasMetaDescription: Boolean(row.has_meta_description),
    h1Count: row.h1_count,
    internalLinkCount: row.internal_link_count,
    externalLinkCount: row.external_link_count,
    imageCount: row.image_count,
    documentLinkCount: row.document_link_count,
    wordCount: row.word_count,
    contentHash: row.content_hash,
    crawlError: row.crawl_error
  };
}

export function resolveSqliteScanStoreInfo(
  options: SqliteScanStoreOptions = {}
): SqliteScanStoreInfo {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  if (options.databasePath) {
    return {
      dataDir: path.dirname(options.databasePath),
      databasePath: options.databasePath
    };
  }

  const configuredDataDir = env.DATA_DIR?.trim();

  if (configuredDataDir) {
    return {
      dataDir: configuredDataDir,
      databasePath: path.join(configuredDataDir, "site-scanner.sqlite")
    };
  }

  const dataDir = path.basename(cwd) === "backend"
    ? path.resolve(cwd, "..", "data")
    : path.resolve(cwd, "data");

  return {
    dataDir,
    databasePath: path.join(dataDir, "site-scanner.sqlite")
  };
}

export class SqliteScanStore {
  readonly databasePath: string;
  readonly dataDir: string;
  private readonly database: DatabaseSync;

  constructor(options: SqliteScanStoreOptions = {}) {
    const info = resolveSqliteScanStoreInfo(options);

    this.databasePath = info.databasePath;
    this.dataDir = info.dataDir;

    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        root_url TEXT NOT NULL,
        origin TEXT NOT NULL,
        hostname TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        status TEXT NOT NULL,
        total_pages_crawled INTEGER NOT NULL,
        total_images_found INTEGER NOT NULL,
        total_documents_linked INTEGER NOT NULL,
        broken_internal_links INTEGER NOT NULL,
        pages_missing_title INTEGER NOT NULL,
        pages_missing_meta_description INTEGER NOT NULL,
        pages_with_no_h1 INTEGER NOT NULL,
        mermaid_sitemap TEXT NOT NULL,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS scan_pages (
        scan_id TEXT NOT NULL,
        page_order INTEGER NOT NULL,
        url TEXT NOT NULL,
        normalized_url TEXT NOT NULL,
        path TEXT NOT NULL,
        parent_url TEXT,
        http_status INTEGER NOT NULL,
        final_url TEXT NOT NULL,
        title TEXT NOT NULL,
        has_meta_description INTEGER NOT NULL,
        h1_count INTEGER NOT NULL,
        internal_link_count INTEGER NOT NULL,
        external_link_count INTEGER NOT NULL,
        image_count INTEGER NOT NULL,
        document_link_count INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        crawl_error TEXT,
        PRIMARY KEY (scan_id, page_order),
        FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scans_origin_end_time
      ON scans(origin, end_time DESC);
    `);
  }

  close() {
    this.database.close();
  }

  saveScan(scan: ScanRecord) {
    const insertScan = this.database.prepare(`
      INSERT INTO scans (
        id, root_url, origin, hostname, start_time, end_time, status,
        total_pages_crawled, total_images_found, total_documents_linked,
        broken_internal_links, pages_missing_title, pages_missing_meta_description,
        pages_with_no_h1, mermaid_sitemap, error_message
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
    `);
    const insertPage = this.database.prepare(`
      INSERT INTO scan_pages (
        scan_id, page_order, url, normalized_url, path, parent_url,
        http_status, final_url, title, has_meta_description, h1_count,
        internal_link_count, external_link_count, image_count,
        document_link_count, word_count, content_hash, crawl_error
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
    `);
    const deletePages = this.database.prepare("DELETE FROM scan_pages WHERE scan_id = ?");
    const deleteScan = this.database.prepare("DELETE FROM scans WHERE id = ?");

    this.database.exec("BEGIN");

    try {
      deletePages.run(scan.id);
      deleteScan.run(scan.id);
      insertScan.run(
        scan.id,
        scan.rootUrl,
        scan.origin,
        scan.hostname,
        scan.startTime,
        scan.endTime,
        scan.status,
        scan.totalPagesCrawled,
        scan.totalImagesFound,
        scan.totalDocumentsLinked,
        scan.brokenInternalLinks,
        scan.pagesMissingTitle,
        scan.pagesMissingMetaDescription,
        scan.pagesWithNoH1,
        scan.mermaidSitemap,
        scan.errorMessage
      );

      scan.pages.forEach((page, index) => {
        insertPage.run(
          scan.id,
          index,
          page.url,
          page.normalizedUrl,
          page.path,
          page.parentUrl,
          page.httpStatus,
          page.finalUrl,
          page.title,
          page.hasMetaDescription ? 1 : 0,
          page.h1Count,
          page.internalLinkCount,
          page.externalLinkCount,
          page.imageCount,
          page.documentLinkCount,
          page.wordCount,
          page.contentHash,
          page.crawlError
        );
      });

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getScanById(id: string): ScanRecord | null {
    const summaryRow = this.database
      .prepare("SELECT * FROM scans WHERE id = ?")
      .get(id) as ScanSummaryRow | undefined;

    if (!summaryRow) {
      return null;
    }

    const pages = this.database
      .prepare("SELECT * FROM scan_pages WHERE scan_id = ? ORDER BY page_order ASC")
      .all(id) as unknown as ScanPageRow[];

    return {
      ...mapSummaryRow(summaryRow),
      pages: pages.map(mapPageRow)
    };
  }

  listScans(): ScanSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM scans ORDER BY end_time DESC, id DESC")
      .all() as unknown as ScanSummaryRow[];

    return rows.map(mapSummaryRow);
  }

  getPreviousCompletedScan(origin: string, beforeEndTime: string, excludeScanId?: string): ScanRecord | null {
    const query = excludeScanId
      ? `
        SELECT * FROM scans
        WHERE origin = ?
          AND status = 'completed'
          AND end_time < ?
          AND id != ?
        ORDER BY end_time DESC, id DESC
        LIMIT 1
      `
      : `
        SELECT * FROM scans
        WHERE origin = ?
          AND status = 'completed'
          AND end_time < ?
        ORDER BY end_time DESC, id DESC
        LIMIT 1
      `;
    const summaryRow = (excludeScanId
      ? this.database.prepare(query).get(origin, beforeEndTime, excludeScanId)
      : this.database.prepare(query).get(origin, beforeEndTime)) as ScanSummaryRow | undefined;

    if (!summaryRow) {
      return null;
    }

    return this.getScanById(summaryRow.id);
  }

  deleteScan(id: string) {
    const deletePages = this.database.prepare("DELETE FROM scan_pages WHERE scan_id = ?");
    const deleteScan = this.database.prepare("DELETE FROM scans WHERE id = ?");

    this.database.exec("BEGIN");

    try {
      deletePages.run(id);
      deleteScan.run(id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
