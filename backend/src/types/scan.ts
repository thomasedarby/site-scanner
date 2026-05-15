export interface ScanPage {
  url: string;
  normalizedUrl: string;
  path: string;
  parentUrl: string | null;
  httpStatus: number;
  finalUrl: string;
  title: string;
  hasMetaDescription: boolean;
  h1Count: number;
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  documentLinkCount: number;
  wordCount: number;
  contentHash: string;
  crawlError: string | null;
}

export interface ScanSummary {
  id: string;
  rootUrl: string;
  origin: string;
  hostname: string;
  pathBoundary: string | null;
  startTime: string;
  endTime: string;
  status: "queued" | "running" | "completed" | "failed";
  totalPagesCrawled: number;
  totalImagesFound: number;
  totalDocumentsLinked: number;
  brokenInternalLinks: number;
  pagesMissingTitle: number;
  pagesMissingMetaDescription: number;
  pagesWithNoH1: number;
  mermaidSitemap: string;
  errorMessage: string | null;
  maxPagesRequested?: number;
  maxPageLimitReached?: boolean;
  crawlDelayMs?: number;
  userAgent?: string;
}

export interface ScanRecord extends ScanSummary {
  pages: ScanPage[];
}

export interface ScanComparison {
  scanId: string;
  previousScanId: string | null;
  addedUrls: string[];
  removedUrls: string[];
  changedUrls: string[];
  changedStatusUrls?: string[];
  summary?: {
    addedPages: number;
    removedPages: number;
    changedPages: number;
    changedStatusPages: number;
  };
}

export interface CreateScanInput {
  url: string;
  maxPages: number;
  pathBoundary?: string | null;
}
