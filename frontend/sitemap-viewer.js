import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict"
});

const EXPORTED_STYLE_PROPERTIES = [
  "fill",
  "color",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "letter-spacing",
  "word-spacing",
  "paint-order"
];

const SVG_TEXT_TAGS = new Set(["text", "tspan", "textpath"]);
const DEFAULT_EXPORT_TEXT_FILL = "#222222";

const params = new URLSearchParams(window.location.search);
const scanId = params.get("id");
const apiBaseOverride = params.get("apiBase") ?? "";

const errorBox = document.getElementById("viewer-error");
const messageBox = document.getElementById("viewer-message");
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

function clearStatusMessages() {
  errorBox.textContent = "";
  messageBox.textContent = "";
  setHidden(errorBox, true);
  setHidden(messageBox, true);
}

function showError(message) {
  messageBox.textContent = "";
  setHidden(messageBox, true);
  errorBox.textContent = message;
  setHidden(errorBox, false);
}

function showMessage(message) {
  errorBox.textContent = "";
  setHidden(errorBox, true);
  messageBox.textContent = message;
  setHidden(messageBox, false);
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

function getRenderedSvg() {
  return diagramContainer.querySelector("svg");
}

function isTransparentColor(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();

  return (
    normalizedValue === "" ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "hsla(0, 0%, 0%, 0)" ||
    normalizedValue === "none"
  );
}

function isWhiteLikeColor(value) {
  const normalizedValue = String(value || "").trim().toLowerCase().replace(/\s+/g, "");

  return normalizedValue === "#fff" ||
    normalizedValue === "#ffffff" ||
    normalizedValue === "white" ||
    normalizedValue === "rgb(255,255,255)" ||
    normalizedValue === "rgba(255,255,255,1)";
}

function applyExportTextFallbacks(sourceNode, clonedNode, computedStyle) {
  const tagName = clonedNode.tagName.toLowerCase();

  if (!SVG_TEXT_TAGS.has(tagName)) {
    return;
  }

  const computedFill = computedStyle.getPropertyValue("fill");
  const computedColor = computedStyle.getPropertyValue("color");
  const existingFill = clonedNode.style.fill || clonedNode.getAttribute("fill") || computedFill || computedColor;
  const chosenFill = isTransparentColor(existingFill) || isWhiteLikeColor(existingFill)
    ? DEFAULT_EXPORT_TEXT_FILL
    : existingFill;

  clonedNode.style.fill = chosenFill;
  clonedNode.setAttribute("fill", chosenFill);

  const fontFamily = computedStyle.getPropertyValue("font-family");
  const fontSize = computedStyle.getPropertyValue("font-size");
  const fontWeight = computedStyle.getPropertyValue("font-weight");
  const fontStyle = computedStyle.getPropertyValue("font-style");
  const textAnchor = computedStyle.getPropertyValue("text-anchor");
  const dominantBaseline = computedStyle.getPropertyValue("dominant-baseline");
  const alignmentBaseline = computedStyle.getPropertyValue("alignment-baseline");
  const opacity = computedStyle.getPropertyValue("opacity");

  if (fontFamily) {
    clonedNode.style.fontFamily = fontFamily;
  }

  if (fontSize) {
    clonedNode.style.fontSize = fontSize;
  }

  if (fontWeight) {
    clonedNode.style.fontWeight = fontWeight;
  }

  if (fontStyle) {
    clonedNode.style.fontStyle = fontStyle;
  }

  if (textAnchor) {
    clonedNode.style.textAnchor = textAnchor;
  }

  if (dominantBaseline) {
    clonedNode.style.dominantBaseline = dominantBaseline;
  }

  if (alignmentBaseline) {
    clonedNode.style.alignmentBaseline = alignmentBaseline;
  }

  if (opacity && !isTransparentColor(opacity)) {
    clonedNode.style.opacity = opacity;
  }

  // Preserve Mermaid label text exactly on leaf text nodes while forcing readable exported paint.
  if (sourceNode.children.length === 0 && sourceNode.textContent !== null) {
    clonedNode.textContent = sourceNode.textContent;
  }
}

function inlineComputedStyles(sourceElement, clonedElement) {
  const sourceNodes = [sourceElement, ...sourceElement.querySelectorAll("*")];
  const clonedNodes = [clonedElement, ...clonedElement.querySelectorAll("*")];

  for (let index = 0; index < sourceNodes.length; index += 1) {
    const sourceNode = sourceNodes[index];
    const clonedNode = clonedNodes[index];

    if (!sourceNode || !clonedNode) {
      continue;
    }

    const computedStyle = window.getComputedStyle(sourceNode);
    const inlineStyle = EXPORTED_STYLE_PROPERTIES
      .map((property) => {
        const value = computedStyle.getPropertyValue(property);
        return value ? `${property}:${value};` : "";
      })
      .filter(Boolean)
      .join("");

    if (inlineStyle) {
      clonedNode.setAttribute("style", inlineStyle);
    }

    applyExportTextFallbacks(sourceNode, clonedNode, computedStyle);
  }
}

function sanitiseSvgForExport(svgElement) {
  const exportedSvg = svgElement.cloneNode(true);
  const renderedWidth = svgElement.viewBox.baseVal.width || svgElement.getBoundingClientRect().width || 1200;
  const renderedHeight = svgElement.viewBox.baseVal.height || svgElement.getBoundingClientRect().height || 800;

  exportedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  exportedSvg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  exportedSvg.setAttribute("width", String(Math.ceil(renderedWidth)));
  exportedSvg.setAttribute("height", String(Math.ceil(renderedHeight)));

  if (!exportedSvg.getAttribute("viewBox")) {
    exportedSvg.setAttribute("viewBox", `0 0 ${Math.ceil(renderedWidth)} ${Math.ceil(renderedHeight)}`);
  }

  inlineComputedStyles(svgElement, exportedSvg);

  for (const node of exportedSvg.querySelectorAll("script, foreignObject")) {
    node.remove();
  }

  for (const styleNode of exportedSvg.querySelectorAll("style")) {
    styleNode.remove();
  }

  for (const node of exportedSvg.querySelectorAll("*")) {
    node.removeAttribute("class");
    node.removeAttribute("tabindex");
    node.removeAttribute("aria-labelledby");
    node.removeAttribute("aria-describedby");

    if (node.tagName.toLowerCase() === "a") {
      node.removeAttribute("href");
      node.removeAttribute("xlink:href");
      node.removeAttribute("target");
      node.removeAttribute("rel");
    }

    if (node.tagName.toLowerCase() === "image" || node.tagName.toLowerCase() === "use") {
      node.removeAttribute("href");
      node.removeAttribute("xlink:href");
    }
  }

  const backgroundRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  backgroundRect.setAttribute("x", "0");
  backgroundRect.setAttribute("y", "0");
  backgroundRect.setAttribute("width", "100%");
  backgroundRect.setAttribute("height", "100%");
  backgroundRect.setAttribute("fill", "#ffffff");
  exportedSvg.insertBefore(backgroundRect, exportedSvg.firstChild);

  return {
    height: Math.max(1, Math.ceil(renderedHeight)),
    svgMarkup: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(exportedSvg)}`,
    width: Math.max(1, Math.ceil(renderedWidth))
  };
}

function downloadSvg() {
  clearStatusMessages();

  const svgElement = getRenderedSvg();

  if (!svgElement) {
    showError("The rendered diagram is not available yet.");
    return;
  }

  const { svgMarkup } = sanitiseSvgForExport(svgElement);
  downloadBlob(
    `scan-${scanId || "sitemap"}.svg`,
    new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" })
  );
}

async function downloadPng() {
  clearStatusMessages();

  const svgElement = getRenderedSvg();

  if (!svgElement) {
    showError("The rendered diagram is not available yet.");
    return;
  }

  const { svgMarkup, width, height } = sanitiseSvgForExport(svgElement);
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

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
          return;
        }

        reject(new Error("The browser did not produce a PNG image."));
      }, "image/png");
    });

    downloadBlob(`scan-${scanId || "sitemap"}.png`, blob);
    showMessage("PNG downloaded.");
  } catch {
    downloadBlob(
      `scan-${scanId || "sitemap"}.svg`,
      new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" })
    );
    showMessage("PNG export was blocked by the browser, so an SVG has been downloaded instead.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  clearStatusMessages();
  void copyText(sitemapSource)
    .then(() => {
      showMessage("Mermaid source copied.");
    })
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
