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
const summaryGrid = document.getElementById("summary-grid");
const detailsLink = document.getElementById("details-link");
const csvLink = document.getElementById("csv-link");
const pagesCsvLink = document.getElementById("pages-csv-link");
const sitemapDownloadLink = document.getElementById("sitemap-download-link");
const compareLink = document.getElementById("compare-link");
const viewSitemapButton = document.getElementById("view-sitemap");
const openSitemapViewerButton = document.getElementById("open-sitemap-viewer");
const copySitemapButton = document.getElementById("copy-sitemap");
const toggleRawSitemapButton = document.getElementById("toggle-raw-sitemap");
const sitemapPanel = document.getElementById("sitemap-panel");
const sitemapLoading = document.getElementById("sitemap-loading");
const sitemapError = document.getElementById("sitemap-error");
const sitemapDiagramShell = document.getElementById("sitemap-diagram-shell");
const sitemapDiagram = document.getElementById("sitemap-diagram");
const sitemapRawShell = document.getElementById("sitemap-raw-shell");
const sitemapOutput = document.getElementById("sitemap-output");
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
  sitemapOutput.textContent = "";
  sitemapError.textContent = "";
  setHidden(sitemapError, true);
  setHidden(sitemapPanel, true);
  setHidden(sitemapLoading, true);
  setHidden(sitemapDiagramShell, true);
  setHidden(sitemapRawShell, true);
  setHidden(toggleRawSitemapButton, true);
  toggleRawSitemapButton.textContent = "Show Mermaid Text";
  viewSitemapButton.textContent = "View Diagram Inline";
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
  if (!currentScanSummary || !currentScanDetails) {
    latestScanContainer.classList.add("hidden");
    latestScanEmpty.classList.remove("hidden");
    return;
  }

  const links = getActiveLinks();

  renderSummary(currentScanSummary, currentScanDetails);
  renderPageTable();

  detailsLink.href = joinApi(links.details);
  csvLink.href = joinApi(links.csv);
  pagesCsvLink.href = joinApi(links.csv);
  sitemapDownloadLink.href = joinApi(links.sitemap);
  compareLink.href = joinApi(links.compare);

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

async function loadScanIntoResults(scanSummary) {
  const scanId = scanSummary.id;
  const scanDetails = await fetchJson(`/api/scans/${scanId}`);

  currentScanSummary = {
    ...scanSummary,
    links: scanSummary.links ?? buildScanLinks(scanId)
  };
  currentScanDetails = scanDetails;
  currentPageFilter = "";
  pageFilterInput.value = "";
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
            <button class="button tertiary open-scan-button" type="button" data-scan-id="${escapeHtml(scan.id)}">Open Result</button>
            <a class="button tertiary" href="${joinApi(links.details)}" target="_blank" rel="noreferrer">Details</a>
            <a class="button tertiary" href="${joinApi(links.csv)}" target="_blank" rel="noreferrer">CSV</a>
            <a class="button tertiary" href="${buildSitemapViewerUrl(scan.id)}" target="_blank" rel="noreferrer">Open Sitemap</a>
            <a class="button tertiary" href="${joinApi(links.compare)}" target="_blank" rel="noreferrer">Compare</a>
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
  setHidden(sitemapRawShell, true);
  setHidden(toggleRawSitemapButton, true);
  sitemapDiagram.innerHTML = "";
  sitemapOutput.textContent = "";
  viewSitemapButton.disabled = true;
  copySitemapButton.disabled = true;
  toggleRawSitemapButton.disabled = true;
  viewSitemapButton.textContent = "Loading Diagram...";

  try {
    sitemapSource = await fetchText(links.sitemap);
    sitemapOutput.textContent = sitemapSource;
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
    copySitemapButton.disabled = false;
    toggleRawSitemapButton.disabled = false;
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
    setHidden(toggleRawSitemapButton, false);
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

async function copySitemapSource() {
  clearError();

  const loaded = await ensureSitemapLoaded();

  if (!loaded || !sitemapSource) {
    return;
  }

  try {
    await copyText(sitemapSource);
    showSuccess("Mermaid source copied.");
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to copy Mermaid source");
  }
}

function toggleRawSitemap() {
  const willShow = sitemapRawShell.classList.contains("hidden");
  setHidden(sitemapRawShell, !willShow);
  toggleRawSitemapButton.textContent = willShow ? "Hide Mermaid Text" : "Show Mermaid Text";
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  clearSuccess();
  clearSitemapState();

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

    await loadScanIntoResults(scan);
    showSuccess(`Scan ${scan.id} completed.`);
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

copySitemapButton.addEventListener("click", () => {
  void copySitemapSource();
});

toggleRawSitemapButton.addEventListener("click", () => {
  toggleRawSitemap();
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
