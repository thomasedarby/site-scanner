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
  startTime: string;
  endTime: string;
  status: "completed";
  totalPagesCrawled: number;
  totalImagesFound: number;
  totalDocumentsLinked: number;
  brokenInternalLinks: number;
  pagesMissingTitle: number;
  pagesMissingMetaDescription: number;
  pagesWithNoH1: number;
  mermaidSitemap: string;
  errorMessage: string | null;
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
}

export interface CreateScanInput {
  url: string;
  maxPages: number;
}
