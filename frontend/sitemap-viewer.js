import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict"
});

const params = new URLSearchParams(window.location.search);
const scanId = params.get("id");
const apiBaseOverride = params.get("apiBase") ?? "";

const errorBox = document.getElementById("viewer-error");
const loadingState = document.getElementById("viewer-loading");
const diagramContainer = document.getElementById("viewer-diagram");
const sourceShell = document.getElementById("viewer-raw-shell");
const sourceOutput = document.getElementById("viewer-source");
const copyMermaidButton = document.getElementById("copy-mermaid-button");
const downloadPngButton = document.getElementById("download-png-button");
const downloadSvgButton = document.getElementById("download-svg-button");
const downloadMermaidLink = document.getElementById("download-mermaid-link");
const toggleSourceButton = document.getElementById("toggle-source-button");

let sitemapSource = "";

function normaliseApiBaseUrl(value) {
  const trimmedValue = String(value || "").trim();

  if (trimmedValue === "" || trimmedValue === "/") {
    return "";
  }

  return trimmedValue.replace(/\/+$/, "");
}

function joinApi(path) {
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = normaliseApiBaseUrl(
    typeof window.API_BASE_URL === "string" ? window.API_BASE_URL : apiBaseOverride
  );

  return baseUrl ? `${baseUrl}${normalisedPath}` : normalisedPath;
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function showError(message) {
  errorBox.textContent = message;
  setHidden(errorBox, false);
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

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function downloadPng() {
  const svgElement = diagramContainer.querySelector("svg");

  if (!svgElement) {
    showError("The rendered diagram is not available yet.");
    return;
  }

  const svgMarkup = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    image.decoding = "async";

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = objectUrl;
    });

    const scale = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1;
    const width = Math.max(1, svgElement.viewBox.baseVal.width || svgElement.getBoundingClientRect().width);
    const height = Math.max(1, svgElement.viewBox.baseVal.height || svgElement.getBoundingClientRect().height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas export is not available in this browser.");
    }

    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!blob) {
      throw new Error("PNG export did not produce an image.");
    }

    downloadBlob(`scan-${scanId || "sitemap"}.png`, blob);
  } catch (error) {
    showError(
      error instanceof Error
        ? `PNG export failed. Downloading SVG instead. ${error.message}`
        : "PNG export failed. Downloading SVG instead."
    );
    downloadSvg();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function downloadSvg() {
  const svgElement = diagramContainer.querySelector("svg");

  if (!svgElement) {
    showError("The rendered diagram is not available yet.");
    return;
  }

  const svgMarkup = new XMLSerializer().serializeToString(svgElement);
  downloadBlob(`scan-${scanId || "sitemap"}.svg`, new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }));
}

async function initializeViewer() {
  if (!scanId) {
    showError("A scan ID is required to open the sitemap viewer.");
    setHidden(loadingState, true);
    return;
  }

  try {
    const response = await fetch(joinApi(`/api/scans/${scanId}/sitemap.mmd`));

    if (!response.ok) {
      throw new Error(`Failed to load sitemap (${response.status})`);
    }

    sitemapSource = await response.text();
    sourceOutput.textContent = sitemapSource;
    downloadMermaidLink.href = joinApi(`/api/scans/${scanId}/sitemap.mmd`);
    downloadMermaidLink.download = `scan-${scanId}.mmd`;

    const { svg } = await mermaid.render(`viewer-diagram-${Date.now()}`, sitemapSource);
    diagramContainer.innerHTML = svg;
  } catch (error) {
    showError(error instanceof Error ? error.message : "Failed to load the sitemap");
  } finally {
    setHidden(loadingState, true);
  }
}

copyMermaidButton.addEventListener("click", () => {
  void copyText(sitemapSource)
    .catch((error) => {
      showError(error instanceof Error ? error.message : "Failed to copy Mermaid source");
    });
});

downloadPngButton.addEventListener("click", () => {
  void downloadPng();
});

downloadSvgButton.addEventListener("click", () => {
  downloadSvg();
});

toggleSourceButton.addEventListener("click", () => {
  const willShow = sourceShell.classList.contains("hidden");
  setHidden(sourceShell, !willShow);
  toggleSourceButton.textContent = willShow ? "Hide Mermaid Text" : "Show Mermaid Text";
});

void initializeViewer();
