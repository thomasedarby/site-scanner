import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const API_BASE_URL = window.API_BASE_URL || "http://localhost:8080";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict"
});

const form = document.getElementById("scan-form");
const urlInput = document.getElementById("url");
const maxPagesInput = document.getElementById("maxPages");
const submitButton = document.getElementById("submit-button");
const loadingState = document.getElementById("loading-state");
const errorBox = document.getElementById("error-box");
const successBox = document.getElementById("success-box");
const latestScanContainer = document.getElementById("latest-scan");
const latestScanEmpty = document.getElementById("latest-scan-empty");
const summaryGrid = document.getElementById("summary-grid");
const detailsLink = document.getElementById("details-link");
const csvLink = document.getElementById("csv-link");
const sitemapDownloadLink = document.getElementById("sitemap-download-link");
const compareLink = document.getElementById("compare-link");
const viewSitemapButton = document.getElementById("view-sitemap");
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

let latestScan = null;
let sitemapSource = "";
let sitemapLoadedForScanId = null;
let renderSequence = 0;

function joinApi(path) {
  return `${API_BASE_URL}${path}`;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  viewSitemapButton.textContent = "View Diagram";
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

function renderSummary(scan) {
  const items = [
    ["Status", scan.status],
    ["Root URL", scan.rootUrl],
    ["Hostname", scan.hostname],
    ["Started", formatDate(scan.startTime)],
    ["Finished", formatDate(scan.endTime)],
    ["Pages", scan.totalPagesCrawled],
    ["Images", scan.totalImagesFound],
    ["Documents", scan.totalDocumentsLinked],
    ["Broken Links", scan.brokenInternalLinks],
    ["Missing Titles", scan.pagesMissingTitle],
    ["Missing Meta", scan.pagesMissingMetaDescription],
    ["No H1", scan.pagesWithNoH1],
    ["Error", scan.errorMessage || "None"]
  ];

  summaryGrid.innerHTML = items
    .map(
      ([label, value]) => `
        <div>
          <dt>${label}</dt>
          <dd>${value}</dd>
        </div>
      `
    )
    .join("");

  detailsLink.href = joinApi(scan.links.details);
  csvLink.href = joinApi(scan.links.csv);
  sitemapDownloadLink.href = joinApi(scan.links.sitemap);
  compareLink.href = joinApi(scan.links.compare);

  latestScan = scan;
  clearSitemapState();
  latestScanEmpty.classList.add("hidden");
  latestScanContainer.classList.remove("hidden");
}

async function fetchJson(path, options) {
  const response = await fetch(joinApi(path), {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
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

async function refreshScans() {
  scanListError.textContent = "";
  setHidden(scanListError, true);

  try {
    const data = await fetchJson("/api/scans");
    const items = data.items || [];

    if (items.length === 0) {
      scanList.innerHTML = "";
      setHidden(scanList, true);
      setHidden(scanListEmpty, false);
      return;
    }

    scanList.innerHTML = items
      .map(
        (scan) => `
          <li>
            <div class="scan-row">
              <strong>${scan.hostname}</strong>
              <span>${scan.status}</span>
            </div>
            <div class="scan-meta">
              ${scan.totalPagesCrawled} pages · ${scan.totalImagesFound} images · ${formatDate(scan.endTime)}
            </div>
            <div class="scan-links">
              <a class="button tertiary" href="${joinApi(`/api/scans/${scan.id}`)}" target="_blank" rel="noreferrer">Details</a>
              <a class="button tertiary" href="${joinApi(`/api/scans/${scan.id}/pages.csv`)}" target="_blank" rel="noreferrer">CSV</a>
              <a class="button tertiary" href="${joinApi(`/api/scans/${scan.id}/sitemap.mmd`)}" target="_blank" rel="noreferrer">Sitemap</a>
              <a class="button tertiary" href="${joinApi(`/api/scans/${scan.id}/compare`)}" target="_blank" rel="noreferrer">Compare</a>
            </div>
          </li>
        `
      )
      .join("");

    setHidden(scanListEmpty, true);
    setHidden(scanList, false);
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
  if (!latestScan) {
    return false;
  }

  if (sitemapLoadedForScanId === latestScan.id && sitemapSource) {
    return true;
  }

  sitemapPanel.classList.remove("hidden");
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
    const response = await fetch(joinApi(latestScan.links.sitemap));
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Failed to load sitemap (${response.status})`);
    }

    sitemapSource = text;
    sitemapOutput.textContent = text;
    sitemapLoadedForScanId = latestScan.id;
    return true;
  } catch (error) {
    sitemapError.textContent = error instanceof Error ? error.message : "Failed to load sitemap";
    setHidden(sitemapError, false);
    viewSitemapButton.textContent = "View Diagram";
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

  if (!latestScan) {
    return;
  }

  if (!sitemapPanel.classList.contains("hidden") && !sitemapDiagramShell.classList.contains("hidden")) {
    setHidden(sitemapPanel, true);
    viewSitemapButton.textContent = "View Diagram";
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
    viewSitemapButton.textContent = "Hide Diagram";
  } catch (error) {
    sitemapError.textContent = error instanceof Error
      ? `Failed to render Mermaid diagram: ${error.message}`
      : "Failed to render Mermaid diagram";
    setHidden(sitemapError, false);
    viewSitemapButton.textContent = "View Diagram";
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

  submitButton.disabled = true;
  setHidden(loadingState, false);

  try {
    const scan = await fetchJson("/api/scans", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    renderSummary(scan);
    showSuccess(`Scan ${scan.id} completed.`);
    await refreshScans();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to start scan");
  } finally {
    submitButton.disabled = false;
    setHidden(loadingState, true);
  }
});

refreshScansButton.addEventListener("click", () => {
  void refreshScans();
});

viewSitemapButton.addEventListener("click", () => {
  void showSitemapDiagram();
});

copySitemapButton.addEventListener("click", () => {
  void copySitemapSource();
});

toggleRawSitemapButton.addEventListener("click", () => {
  toggleRawSitemap();
});

void refreshScans();
