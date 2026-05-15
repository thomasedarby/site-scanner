import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const API_BASE_URL = typeof window.API_BASE_URL === "string" ? window.API_BASE_URL : "";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict"
});

const form = document.getElementById("scan-form");
const siteSelect = document.getElementById("site-select");
const siteSelectHelp = document.getElementById("site-select-help");
const urlInput = document.getElementById("url");
const maxPagesInput = document.getElementById("maxPages");
const restrictPathCheckbox = document.getElementById("restrict-path");
const pathBoundaryField = document.getElementById("path-boundary-field");
const pathBoundaryInput = document.getElementById("pathBoundary");
const submitButton = document.getElementById("submit-button");
const loadingState = document.getElementById("loading-state");
const errorBox = document.getElementById("error-box");
const successBox = document.getElementById("success-box");
const latestScanContainer = document.getElementById("latest-scan");
const latestScanEmpty = document.getElementById("latest-scan-empty");
const scanStatusPanel = document.getElementById("scan-status-panel");
const scanStatusMessage = document.getElementById("scan-status-message");
const scanStatusBadge = document.getElementById("scan-status-badge");
const scanStatusSpinner = document.getElementById("scan-status-spinner");
const scanStatusGrid = document.getElementById("scan-status-grid");
const scanProgressShell = document.getElementById("scan-progress-shell");
const scanProgressBar = document.getElementById("scan-progress-bar");
const scanProgressText = document.getElementById("scan-progress-text");
const summaryGrid = document.getElementById("summary-grid");
const detailsLink = document.getElementById("details-link");
const pagesCsvLink = document.getElementById("pages-csv-link");
const viewSitemapButton = document.getElementById("view-sitemap");
const openSitemapViewerButton = document.getElementById("open-sitemap-viewer");
const exportPdfReportButton = document.getElementById("export-pdf-report");
const sitemapPanel = document.getElementById("sitemap-panel");
const sitemapLoading = document.getElementById("sitemap-loading");
const sitemapError = document.getElementById("sitemap-error");
const sitemapDiagramShell = document.getElementById("sitemap-diagram-shell");
const sitemapDiagram = document.getElementById("sitemap-diagram");
const refreshScansButton = document.getElementById("refresh-scans");
const scanList = document.getElementById("scan-list");
const scanListEmpty = document.getElementById("scan-list-empty");
const scanListError = document.getElementById("scan-list-error");
const pageFilterInput = document.getElementById("page-filter");
const copyPagesButton = document.getElementById("copy-pages-button");
const pageTableBody = document.getElementById("page-table-body");
const pagesEmpty = document.getElementById("pages-empty");
const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
const tabPanels = {
  "new-scan": document.getElementById("panel-new-scan"),
  results: document.getElementById("panel-results"),
  "previous-scans": document.getElementById("panel-previous-scans")
};

let currentScanSummary = null;
let currentScanDetails = null;
let sitemapSource = "";
let sitemapLoadedForScanId = null;
let renderSequence = 0;
let currentPageFilter = "";
let availableSites = [];
let pathBoundaryTouched = false;
let currentScanStatus = null;
let activeStatusPollId = null;
let activeStatusPollTimer = null;

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

function buildScanLinks(id) {
  return {
    compare: `/api/scans/${id}/compare`,
    csv: `/api/scans/${id}/pages.csv`,
    details: `/api/scans/${id}`,
    status: `/api/scans/${id}/status`,
    sitemap: `/api/scans/${id}/sitemap.mmd`
  };
}

function buildSitemapViewerUrl(scanId) {
  const viewerUrl = new URL("/sitemap-viewer.html", window.location.href);
  viewerUrl.searchParams.set("id", scanId);

  const baseUrl = normaliseApiBaseUrl(API_BASE_URL);

  if (baseUrl) {
    viewerUrl.searchParams.set("apiBase", baseUrl);
  }

  return viewerUrl.toString();
}

function buildReportViewerUrl(scanId) {
  const reportUrl = new URL("/report.html", window.location.href);
  reportUrl.searchParams.set("id", scanId);

  const baseUrl = normaliseApiBaseUrl(API_BASE_URL);

  if (baseUrl) {
    reportUrl.searchParams.set("apiBase", baseUrl);
  }

  return reportUrl.toString();
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function showError(message) {
  errorBox.textContent = message;
  setHidden(errorBox, false);
}

function clearError() {
  errorBox.textContent = "";
  setHidden(errorBox, true);
}

function showSuccess(message) {
  successBox.textContent = message;
  setHidden(successBox, false);
}

function clearSuccess() {
  successBox.textContent = "";
  setHidden(successBox, true);
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

function formatMaybeValue(value, fallback = "N/A") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function stopStatusPolling() {
  activeStatusPollId = null;

  if (activeStatusPollTimer) {
    window.clearTimeout(activeStatusPollTimer);
    activeStatusPollTimer = null;
  }
}

function normaliseUserEnteredUrl(rawValue) {
  const trimmedValue = String(rawValue || "").trim();

  if (trimmedValue === "") {
    return null;
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;

  try {
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

function normalisePathBoundaryValue(rawValue) {
  const trimmedValue = String(rawValue || "").trim();

  if (trimmedValue === "") {
    return "";
  }

  if (!trimmedValue.startsWith("/")) {
    return trimmedValue;
  }

  if (trimmedValue === "/") {
    return "/";
  }

  return `${trimmedValue.replace(/\/+$/, "")}/`;
}

function deriveBoundaryFromUrlValue(rawUrl) {
  const parsedUrl = normaliseUserEnteredUrl(rawUrl);

  if (!parsedUrl || parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
    return "";
  }

  return normalisePathBoundaryValue(parsedUrl.pathname);
}

function updatePathBoundaryFieldVisibility() {
  setHidden(pathBoundaryField, !restrictPathCheckbox.checked);
}

function maybePopulatePathBoundaryFromUrl() {
  if (!restrictPathCheckbox.checked || pathBoundaryTouched) {
    return;
  }

  const derivedBoundary = deriveBoundaryFromUrlValue(urlInput.value);

  if (derivedBoundary) {
    pathBoundaryInput.value = derivedBoundary;
  }
}

function clearSitemapState() {
  sitemapSource = "";
  sitemapLoadedForScanId = null;
  sitemapDiagram.innerHTML = "";
  sitemapError.textContent = "";
  setHidden(sitemapError, true);
  setHidden(sitemapPanel, true);
  setHidden(sitemapLoading, true);
  setHidden(sitemapDiagramShell, true);
  viewSitemapButton.textContent = "View Diagram Inline";
}

function resetCurrentScanView() {
  currentScanSummary = null;
  currentScanDetails = null;
  currentScanStatus = null;
  currentPageFilter = "";
  pageFilterInput.value = "";
  pageTableBody.innerHTML = "";
  setHidden(pagesEmpty, true);
  clearSitemapState();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "absolute";
  helper.style.left = "-9999px";
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  document.body.removeChild(helper);
}

function switchTab(tabName) {
  for (const button of tabButtons) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }

  for (const [panelName, panel] of Object.entries(tabPanels)) {
    setHidden(panel, panelName !== tabName);
  }
}

function getActiveLinks() {
  if (!currentScanSummary?.id) {
    return null;
  }

  return currentScanSummary.links ?? buildScanLinks(currentScanSummary.id);
}

function renderStatusPanel(status) {
  currentScanStatus = status;

  if (!status) {
    setHidden(scanStatusPanel, true);
    return;
  }

  const isActive = status.status === "queued" || status.status === "running";
  const elapsedLabel = formatDuration(status.startedAt, status.finishedAt || new Date().toISOString());
  const progressText = status.maxPages
    ? `Crawled ${status.totalPagesCrawled} of ${status.maxPages} pages`
    : `Crawled ${status.totalPagesCrawled} pages`;
  const statusItems = [
    ["Started", formatDate(status.startedAt)],
    ["Updated", formatDate(status.updatedAt)],
    ["Finished", formatDate(status.finishedAt)],
    ["Elapsed", elapsedLabel],
    ["Pages Crawled", status.totalPagesCrawled],
    ["Pages Queued", status.pagesQueued ?? "N/A"],
    ["Current URL", status.currentUrl || "N/A"]
  ];

  scanStatusMessage.textContent = status.message || "Waiting for updates.";
  scanStatusBadge.textContent = status.status;
  scanStatusBadge.classList.toggle("error", status.status === "failed");
  setHidden(scanStatusSpinner, !isActive);

  if (typeof status.progressPercent === "number") {
    setHidden(scanProgressShell, false);
    scanProgressBar.style.width = `${status.progressPercent}%`;
    scanProgressText.textContent = `${progressText} · ${status.progressPercent}%`;
  } else {
    setHidden(scanProgressShell, !isActive);
    scanProgressBar.style.width = isActive ? "35%" : "0%";
    scanProgressText.textContent = progressText;
  }

  scanStatusGrid.innerHTML = statusItems
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `
    )
    .join("");

  setHidden(scanStatusPanel, false);
}

function renderSummary(scanSummary, scanDetails) {
  const scan = scanDetails ?? scanSummary;
  const pagesVsLimit = scanSummary?.maxPagesRequested
    ? `${scan.totalPagesCrawled} / ${scanSummary.maxPagesRequested}`
    : `${scan.totalPagesCrawled}`;

  const items = [
    ["Root URL", scan.rootUrl],
    ["Hostname", scan.hostname],
    ["Path Boundary", scan.pathBoundary || "None"],
    ["Status", scan.status],
    ["Started", formatDate(scan.startTime)],
    ["Finished", formatDate(scan.endTime)],
    ["Duration", formatDuration(scan.startTime, scan.endTime)],
    ["Total Pages", scan.totalPagesCrawled],
    ["Pages vs Max", pagesVsLimit],
    ["Max Limit Reached", scanSummary?.maxPageLimitReached === undefined ? "N/A" : scanSummary.maxPageLimitReached ? "Yes" : "No"],
    ["Total Images", scan.totalImagesFound],
    ["Total Documents", scan.totalDocumentsLinked],
    ["Broken Links", scan.brokenInternalLinks],
    ["Missing Titles", scan.pagesMissingTitle],
    ["Missing Meta Descriptions", scan.pagesMissingMetaDescription],
    ["Pages With No H1", scan.pagesWithNoH1],
    ["Crawl Delay", scanSummary?.crawlDelayMs === undefined ? "N/A" : `${scanSummary.crawlDelayMs} ms`],
    ["User Agent", formatMaybeValue(scanSummary?.userAgent)],
    ["Error Message", scan.errorMessage || "None"]
  ];

  summaryGrid.innerHTML = items
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

function renderPageTable() {
  const pages = currentScanDetails?.pages ?? [];

  if (pages.length === 0) {
    pageTableBody.innerHTML = "";
    setHidden(pagesEmpty, false);
    return;
  }

  const filter = currentPageFilter.trim().toLowerCase();
  const filteredPages = filter
    ? pages.filter((page) => {
        const haystack = [
          page.title,
          page.url,
          String(page.httpStatus),
          page.crawlError || "",
          page.hasMetaDescription ? "no missing meta" : "missing meta"
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(filter);
      })
    : pages;

  if (filteredPages.length === 0) {
    pageTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="helper">No pages match the current filter.</td>
      </tr>
    `;
    setHidden(pagesEmpty, true);
    return;
  }

  pageTableBody.innerHTML = filteredPages
    .map((page) => {
      const titleClass = page.title ? "page-title" : "page-title muted";
      const statusClass = page.httpStatus >= 400 ? "status-pill error" : "status-pill";

      return `
        <tr>
          <td><span class="${titleClass}">${escapeHtml(page.title || "Untitled")}</span></td>
          <td><a href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.url)}</a></td>
          <td><span class="${statusClass}">${escapeHtml(page.httpStatus)}</span></td>
          <td>${escapeHtml(page.h1Count)}</td>
          <td>${escapeHtml(page.imageCount)}</td>
          <td>${escapeHtml(page.documentLinkCount)}</td>
          <td>${escapeHtml(page.wordCount)}</td>
          <td>${page.hasMetaDescription ? "No" : "Yes"}</td>
          <td>${escapeHtml(page.crawlError || "")}</td>
        </tr>
      `;
    })
    .join("");

  setHidden(pagesEmpty, true);
}

function renderCurrentScan() {
  if (!currentScanSummary) {
    latestScanContainer.classList.add("hidden");
    latestScanEmpty.classList.remove("hidden");
    return;
  }

  const links = getActiveLinks();

  renderStatusPanel(currentScanStatus);
  renderSummary(currentScanSummary, currentScanDetails ?? currentScanSummary);

  if (currentScanDetails) {
    renderPageTable();
  } else {
    pageTableBody.innerHTML = "";
    setHidden(pagesEmpty, false);
  }

  detailsLink.href = joinApi(links.details);
  pagesCsvLink.href = joinApi(links.csv);

  latestScanEmpty.classList.add("hidden");
  latestScanContainer.classList.remove("hidden");
}

async function fetchJson(path, options) {
  let response;

  try {
    response = await fetch(joinApi(path), {
      headers: {
        "Content-Type": "application/json"
      },
      ...options
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

async function fetchText(path) {
  let response;

  try {
    response = await fetch(joinApi(path));
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not reach the API. ${error.message}`
        : "Could not reach the API."
    );
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return text;
}

async function fetchScanStatus(scanId) {
  return fetchJson(`/api/scans/${scanId}/status`);
}

async function loadCompletedScan(scanSummary) {
  const scanId = scanSummary.id;
  const scanDetails = await fetchJson(`/api/scans/${scanId}`);

  currentScanSummary = {
    ...scanSummary,
    links: scanSummary.links ?? buildScanLinks(scanId)
  };
  currentScanDetails = scanDetails;
  renderCurrentScan();
}

function scheduleStatusPoll(scanId) {
  activeStatusPollTimer = window.setTimeout(() => {
    void pollScanStatus(scanId);
  }, 1500);
}

async function pollScanStatus(scanId) {
  if (activeStatusPollId !== scanId) {
    return;
  }

  try {
    const status = await fetchScanStatus(scanId);

    if (activeStatusPollId !== scanId) {
      return;
    }

    currentScanStatus = status;
    renderCurrentScan();

    if (status.status === "completed") {
      stopStatusPolling();
      await loadCompletedScan({
        ...(currentScanSummary ?? { id: scanId }),
        status: "completed"
      });
      showSuccess(`Scan ${scanId} completed.`);
      await refreshScans();
      return;
    }

    if (status.status === "failed") {
      stopStatusPolling();
      const failedDetails = await fetchJson(`/api/scans/${scanId}`);
      currentScanSummary = {
        ...(currentScanSummary ?? { id: scanId, links: buildScanLinks(scanId) }),
        ...failedDetails,
        links: (currentScanSummary?.links ?? buildScanLinks(scanId))
      };
      currentScanDetails = failedDetails;
      renderCurrentScan();
      showError(status.message || "Scan failed");
      await refreshScans();
      return;
    }

    scheduleStatusPoll(scanId);
  } catch (error) {
    stopStatusPolling();
    showError(error instanceof Error ? error.message : "Failed to load scan status");
  }
}

function startStatusPolling(scanSummary) {
  stopStatusPolling();
  activeStatusPollId = scanSummary.id;
  currentScanSummary = scanSummary;
  currentScanDetails = null;
  currentScanStatus = {
    id: scanSummary.id,
    status: scanSummary.status,
    totalPagesCrawled: scanSummary.totalPagesCrawled ?? 0,
    pagesQueued: 1,
    maxPages: scanSummary.maxPagesRequested ?? null,
    progressPercent: 0,
    startedAt: scanSummary.startTime,
    updatedAt: scanSummary.startTime,
    finishedAt: null,
    currentUrl: null,
    message: "Scan queued"
  };
  renderCurrentScan();
  scheduleStatusPoll(scanSummary.id);
}

async function loadScanIntoResults(scanSummary) {
  stopStatusPolling();
  const scanId = scanSummary.id;
  const scanDetails = await fetchJson(`/api/scans/${scanId}`);

  currentScanSummary = {
    ...scanSummary,
    links: scanSummary.links ?? buildScanLinks(scanId)
  };
  currentScanDetails = scanDetails;
  currentPageFilter = "";
  pageFilterInput.value = "";
  currentScanStatus = null;
  clearSitemapState();
  renderCurrentScan();
  switchTab("results");
}

function renderSiteOptions(sites) {
  availableSites = sites;

  if (sites.length === 0) {
    siteSelect.innerHTML = '<option value="">Custom URL</option>';
    siteSelectHelp.textContent = "Enter a custom URL and optionally restrict the crawl to its path.";
    return;
  }

  siteSelect.innerHTML = [
    '<option value="">Custom URL</option>',
    ...sites.map((site, index) => `<option value="${index}">${escapeHtml(site.name)}</option>`)
  ].join("");
  siteSelectHelp.textContent = "Choose a configured section scan, or leave this on Custom URL.";
}

async function loadScannerConfig() {
  try {
    const config = await fetchJson("/api/scanner-config");
    renderSiteOptions(config.sites || []);
  } catch (error) {
    console.debug("Scanner config could not be loaded for site presets.", error);
    renderSiteOptions([]);
  }
}

function renderScansList(items) {
  if (items.length === 0) {
    scanList.innerHTML = "";
    setHidden(scanList, true);
    setHidden(scanListEmpty, false);
    return;
  }

  scanList.innerHTML = items
    .map((scan) => {
      const links = buildScanLinks(scan.id);

      return `
        <li>
          <div class="scan-row">
            <strong>${escapeHtml(scan.hostname)}</strong>
            <span class="status-pill ${scan.status === "failed" ? "error" : ""}">${escapeHtml(scan.status)}</span>
          </div>
          <div class="scan-meta">
            ${escapeHtml(`${scan.totalPagesCrawled} pages · ${scan.totalImagesFound} images · ${formatDate(scan.endTime)}`)}
            ${scan.pathBoundary ? `<br>${escapeHtml(`Path boundary: ${scan.pathBoundary}`)}` : ""}
          </div>
          <div class="scan-links">
            <button class="button tertiary open-scan-button" type="button" data-scan-id="${escapeHtml(scan.id)}">View Results</button>
            <a class="button tertiary" href="${buildSitemapViewerUrl(scan.id)}" target="_blank" rel="noreferrer">Open Sitemap</a>
            <a class="button tertiary" href="${buildReportViewerUrl(scan.id)}" target="_blank" rel="noreferrer">Export PDF Report</a>
            <button class="button tertiary delete-scan-button" type="button" data-scan-id="${escapeHtml(scan.id)}" ${scan.status === "queued" || scan.status === "running" ? "disabled" : ""}>Delete</button>
          </div>
        </li>
      `;
    })
    .join("");

  for (const button of scanList.querySelectorAll(".open-scan-button")) {
    button.addEventListener("click", () => {
      const selectedScan = items.find((scan) => scan.id === button.dataset.scanId);

      if (!selectedScan) {
        return;
      }

      clearError();
      clearSuccess();
      void loadScanIntoResults(selectedScan).catch((error) => {
        showError(error instanceof Error ? error.message : "Failed to load scan details");
      });
    });
  }

  for (const button of scanList.querySelectorAll(".delete-scan-button")) {
    button.addEventListener("click", () => {
      void deleteScan(button.dataset.scanId);
    });
  }

  setHidden(scanListEmpty, true);
  setHidden(scanList, false);
}

async function refreshScans() {
  scanListError.textContent = "";
  setHidden(scanListError, true);

  try {
    const data = await fetchJson("/api/scans");
    renderScansList(data.items || []);
  } catch (error) {
    scanListError.textContent = error instanceof Error ? error.message : "Failed to load previous scans";
    setHidden(scanListError, false);
  }
}

async function renderSitemapDiagram(source) {
  renderSequence += 1;
  const diagramId = `scan-sitemap-${renderSequence}`;
  const { svg } = await mermaid.render(diagramId, source);
  sitemapDiagram.innerHTML = svg;
}

async function ensureSitemapLoaded() {
  const links = getActiveLinks();

  if (!currentScanSummary || !links) {
    return false;
  }

  if (sitemapLoadedForScanId === currentScanSummary.id && sitemapSource) {
    return true;
  }

  setHidden(sitemapPanel, false);
  setHidden(sitemapLoading, false);
  setHidden(sitemapError, true);
  setHidden(sitemapDiagramShell, true);
  sitemapDiagram.innerHTML = "";
  viewSitemapButton.disabled = true;
  viewSitemapButton.textContent = "Loading Diagram...";

  try {
    sitemapSource = await fetchText(links.sitemap);
    sitemapLoadedForScanId = currentScanSummary.id;
    return true;
  } catch (error) {
    sitemapError.textContent = error instanceof Error ? error.message : "Failed to load sitemap";
    setHidden(sitemapError, false);
    viewSitemapButton.textContent = "View Diagram Inline";
    return false;
  } finally {
    setHidden(sitemapLoading, true);
    viewSitemapButton.disabled = false;
  }
}

async function showSitemapDiagram() {
  clearError();

  if (!currentScanSummary) {
    return;
  }

  if (!sitemapPanel.classList.contains("hidden") && !sitemapDiagramShell.classList.contains("hidden")) {
    setHidden(sitemapPanel, true);
    viewSitemapButton.textContent = "View Diagram Inline";
    return;
  }

  const loaded = await ensureSitemapLoaded();

  if (!loaded) {
    return;
  }

  try {
    viewSitemapButton.disabled = true;
    viewSitemapButton.textContent = "Rendering Diagram...";
    await renderSitemapDiagram(sitemapSource);
    setHidden(sitemapPanel, false);
    setHidden(sitemapDiagramShell, false);
    viewSitemapButton.textContent = "Hide Inline Diagram";
  } catch (error) {
    sitemapError.textContent = error instanceof Error
      ? `Failed to render Mermaid diagram: ${error.message}`
      : "Failed to render Mermaid diagram";
    setHidden(sitemapError, false);
    viewSitemapButton.textContent = "View Diagram Inline";
  } finally {
    viewSitemapButton.disabled = false;
  }
}

function buildPageExportText(pages) {
  const header = [
    "Title",
    "URL",
    "Status",
    "H1 Count",
    "Image Count",
    "Document Count",
    "Word Count",
    "Missing Meta Description",
    "Crawl Error"
  ];

  const lines = pages.map((page) => [
    page.title || "Untitled",
    page.url,
    page.httpStatus,
    page.h1Count,
    page.imageCount,
    page.documentLinkCount,
    page.wordCount,
    page.hasMetaDescription ? "No" : "Yes",
    page.crawlError || ""
  ]);

  return [header, ...lines].map((row) => row.join("\t")).join("\n");
}

async function copyPages() {
  if (!currentScanDetails?.pages?.length) {
    showError("There are no stored page rows to copy yet.");
    return;
  }

  try {
    await copyText(buildPageExportText(currentScanDetails.pages));
    showSuccess("Page list copied.");
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to copy page list");
  }
}

function openSitemapViewer() {
  if (!currentScanSummary?.id) {
    return;
  }

  window.open(buildSitemapViewerUrl(currentScanSummary.id), "_blank", "noopener");
}

function openReportViewer(scanId = currentScanSummary?.id) {
  if (!scanId) {
    return;
  }

  window.open(buildReportViewerUrl(scanId), "_blank", "noopener");
}

async function deleteScan(scanId) {
  if (!scanId) {
    return;
  }

  const confirmed = window.confirm("Delete this scan and its stored page results?");

  if (!confirmed) {
    return;
  }

  clearError();
  clearSuccess();

  try {
    await fetchJson(`/api/scans/${scanId}`, {
      method: "DELETE"
    });

    if (currentScanSummary?.id === scanId) {
      stopStatusPolling();
      resetCurrentScanView();
      renderCurrentScan();
      switchTab("previous-scans");
      showSuccess("This scan has been deleted.");
    } else {
      showSuccess("Scan deleted.");
    }

    await refreshScans();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to delete scan");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  clearSuccess();
  stopStatusPolling();
  resetCurrentScanView();
  switchTab("results");

  const payload = {
    url: urlInput.value.trim()
  };
  const maxPagesValue = maxPagesInput.value.trim();

  if (maxPagesValue) {
    payload.maxPages = Number(maxPagesValue);
  }

  if (restrictPathCheckbox.checked) {
    const normalizedBoundary = normalisePathBoundaryValue(pathBoundaryInput.value);

    if (normalizedBoundary) {
      payload.pathBoundary = normalizedBoundary;
    }
  }

  submitButton.disabled = true;
  setHidden(loadingState, false);

  try {
    const scan = await fetchJson("/api/scans", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    startStatusPolling(scan);
    showSuccess(`Scan ${scan.id} started.`);
    await refreshScans();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to start scan");
  } finally {
    submitButton.disabled = false;
    setHidden(loadingState, true);
  }
});

siteSelect.addEventListener("change", () => {
  const selectedIndex = siteSelect.value;

  if (selectedIndex === "") {
    pathBoundaryTouched = false;
    return;
  }

  const selectedSite = availableSites[Number(selectedIndex)];

  if (!selectedSite) {
    return;
  }

  urlInput.value = selectedSite.url;
  restrictPathCheckbox.checked = Boolean(selectedSite.pathBoundary);
  pathBoundaryTouched = false;
  pathBoundaryInput.value = selectedSite.pathBoundary || deriveBoundaryFromUrlValue(selectedSite.url);
  updatePathBoundaryFieldVisibility();
});

restrictPathCheckbox.addEventListener("change", () => {
  updatePathBoundaryFieldVisibility();

  if (restrictPathCheckbox.checked) {
    maybePopulatePathBoundaryFromUrl();
  } else {
    pathBoundaryTouched = false;
    pathBoundaryInput.value = "";
  }
});

urlInput.addEventListener("blur", () => {
  maybePopulatePathBoundaryFromUrl();
});

pathBoundaryInput.addEventListener("input", () => {
  pathBoundaryTouched = true;
});

refreshScansButton.addEventListener("click", () => {
  void refreshScans();
});

viewSitemapButton.addEventListener("click", () => {
  void showSitemapDiagram();
});

openSitemapViewerButton.addEventListener("click", () => {
  openSitemapViewer();
});

exportPdfReportButton.addEventListener("click", () => {
  openReportViewer();
});

copyPagesButton.addEventListener("click", () => {
  void copyPages();
});

pageFilterInput.addEventListener("input", () => {
  currentPageFilter = pageFilterInput.value;
  renderPageTable();
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  });
}

updatePathBoundaryFieldVisibility();
void loadScannerConfig();
void refreshScans();
