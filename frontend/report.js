const API_BASE_URL = new URLSearchParams(window.location.search).get("apiBase")
  || (typeof window.API_BASE_URL === "string" ? window.API_BASE_URL : "");

const reportError = document.getElementById("report-error");
const reportLoading = document.getElementById("report-loading");
const reportContent = document.getElementById("report-content");
const reportTitle = document.getElementById("report-title");
const reportSubtitle = document.getElementById("report-subtitle");
const reportExportedAt = document.getElementById("report-exported-at");
const reportScanId = document.getElementById("report-scan-id");
const reportSummary = document.getElementById("report-summary");
const reportPageTableBody = document.getElementById("report-page-table-body");
const printReportButton = document.getElementById("print-report-button");

function normaliseApiBaseUrl(value) {
  const trimmedValue = String(value || "").trim();

  if (trimmedValue === "" || trimmedValue === "/") {
    return "";
  }

  return trimmedValue.replace(/\/+$/, "");
}

function joinApi(path) {
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = normaliseApiBaseUrl(API_BASE_URL);

  return baseUrl ? `${baseUrl}${normalisedPath}` : normalisedPath;
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function showError(message) {
  reportError.textContent = message;
  setHidden(reportError, false);
}

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) {
    return "N/A";
  }

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "N/A";
  }

  const totalSeconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(path) {
  let response;

  try {
    response = await fetch(joinApi(path), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not reach the API. ${error.message}`
        : "Could not reach the API."
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? data.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function renderSummary(scan) {
  const items = [
    ["Root URL", scan.rootUrl],
    ["Hostname", scan.hostname],
    ["Status", scan.status],
    ["Started", formatDate(scan.startTime)],
    ["Finished", formatDate(scan.endTime)],
    ["Duration", formatDuration(scan.startTime, scan.endTime)],
    ["Path Boundary", scan.pathBoundary || "None"],
    ["Total Pages Crawled", scan.totalPagesCrawled],
    ["Total Images Found", scan.totalImagesFound],
    ["Total Documents Linked", scan.totalDocumentsLinked],
    ["Broken Internal Links", scan.brokenInternalLinks],
    ["Pages Missing Title", scan.pagesMissingTitle],
    ["Pages Missing Meta Description", scan.pagesMissingMetaDescription],
    ["Pages With No H1", scan.pagesWithNoH1],
    ["Crawl Error", scan.errorMessage || "None"]
  ];

  reportSummary.innerHTML = items
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `
    )
    .join("");
}

function renderPages(scan) {
  const pages = scan.pages || [];

  if (pages.length === 0) {
    reportPageTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="helper">No stored pages were found for this scan.</td>
      </tr>
    `;
    return;
  }

  reportPageTableBody.innerHTML = pages
    .map((page) => `
      <tr>
        <td>${escapeHtml(page.title || "Untitled")}</td>
        <td>${escapeHtml(page.url)}</td>
        <td>${escapeHtml(page.httpStatus)}</td>
        <td>${escapeHtml(page.h1Count)}</td>
        <td>${escapeHtml(page.imageCount)}</td>
        <td>${escapeHtml(page.documentLinkCount)}</td>
        <td>${escapeHtml(page.wordCount)}</td>
        <td>${page.hasMetaDescription ? "No" : "Yes"}</td>
        <td>${escapeHtml(page.crawlError || "")}</td>
      </tr>
    `)
    .join("");
}

async function loadReport() {
  const scanId = new URLSearchParams(window.location.search).get("id");

  if (!scanId) {
    showError("A scan ID is required to open this report.");
    setHidden(reportLoading, true);
    return;
  }

  try {
    const scan = await fetchJson(`/api/scans/${scanId}`);
    reportTitle.textContent = `Scan report for ${scan.hostname}`;
    reportSubtitle.textContent = scan.rootUrl;
    reportExportedAt.textContent = formatDate(new Date().toISOString());
    reportScanId.textContent = scan.id;
    renderSummary(scan);
    renderPages(scan);
    setHidden(reportContent, false);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to load the report.");
  } finally {
    setHidden(reportLoading, true);
  }
}

printReportButton.addEventListener("click", () => {
  window.print();
});

void loadReport();
