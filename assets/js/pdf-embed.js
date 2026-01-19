let pdfjs = null;
let loadingPromise = null;

async function loadPdfjsOnce() {
  if (pdfjs) return pdfjs;
  if (loadingPromise) return loadingPromise;

  const cfg = window.ProLandPdfEmbedESM || {};
  const displaySrc = cfg.pdfjsDisplaySrc;
  const workerSrc = cfg.pdfjsWorkerSrc;

  if (!displaySrc || !workerSrc) {
    throw new Error("ProLand PDF Embed: missing PDF.js paths (pdfjsDisplaySrc/pdfjsWorkerSrc).");
  }

  loadingPromise = import(displaySrc).then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = workerSrc;
    pdfjs = mod;
    return pdfjs;
  });

  return loadingPromise;
}

function clearStatus(root) {
  const status = root.querySelector(".proland-pdf-status");
  if (status) status.remove();
}

function setStatus(root, html) {
  const container = root.querySelector(".proland-pdf-pages");
  if (!container) return;

  let status = root.querySelector(".proland-pdf-status");
  if (!status) {
    status = document.createElement("div");
    status.className = "proland-pdf-status";
    status.style.padding = "12px";
    status.style.border = "1px solid #eee";
    status.style.borderRadius = "10px";
    status.style.marginBottom = "12px";
    status.style.background = "#fff";
    container.prepend(status);
  }
  status.innerHTML = html;
}

// Try to extract a URL from various annotation shapes
function extractUrl(ann) {
  if (!ann) return null;

  // Common direct fields
  if (typeof ann.url === "string" && ann.url) return ann.url;
  if (typeof ann.unsafeUrl === "string" && ann.unsafeUrl) return ann.unsafeUrl;

  // Some builds store it under `A` action dictionary
  // e.g. ann.A = { S: "URI", URI: "https://..." }
  if (ann.A && typeof ann.A === "object") {
    if (ann.A.URI && typeof ann.A.URI === "string") return ann.A.URI;
  }

  // Some store `action` with `url`
  if (ann.action && typeof ann.action === "object" && typeof ann.action.url === "string") {
    return ann.action.url;
  }

  return null;
}

// Create clickable overlays for annotations with URLs
function buildLinkOverlays({ annLayer, annotations, viewport }) {
  // viewport is the SCALED viewport used to render the canvas
  // We'll position overlays in canvas pixel coordinates (same as viewport)
  let count = 0;

  for (const ann of annotations) {
    const url = extractUrl(ann);
    if (!url) continue;

    // We need a rect; PDF.js annotations usually include `rect: [x1,y1,x2,y2]` in PDF points
    const rect = ann.rect;
    if (!Array.isArray(rect) || rect.length !== 4) continue;

    // Convert PDF rect into viewport pixel rect
    // convertToViewportRectangle returns [x1, y1, x2, y2] in viewport coords
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    // Ignore tiny/invalid rectangles
    if (!(width > 2 && height > 2)) continue;

    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.position = "absolute";
    a.style.left = `${left}px`;
    a.style.top = `${top}px`;
    a.style.width = `${width}px`;
    a.style.height = `${height}px`;
    a.style.display = "block";
    a.style.cursor = "pointer";
    a.style.background = "transparent";
    a.style.pointerEvents = "auto";

    // Optional: debug outline if you ever need it
    // a.style.outline = "2px solid rgba(255,0,0,0.35)";

    annLayer.appendChild(a);
    count++;
  }

  return count;
}

async function renderEmbed(root) {
  const pdfUrl = root.getAttribute("data-pdf-url");
  const maxWidth = parseInt(root.getAttribute("data-max-width") || "1100", 10);

  const pagesContainer = root.querySelector(".proland-pdf-pages");
  if (!pagesContainer) return;

  let renderedAnyPage = false;

  try {
    const pdfjsLib = await loadPdfjsOnce();

    setStatus(root, "Loading document…");

    const pdf = await pdfjsLib.getDocument({
      url: pdfUrl,
      enableXfa: false,
    }).promise;

    clearStatus(root);

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);

      const pageWrap = document.createElement("div");
      pageWrap.style.position = "relative";
      pageWrap.style.margin = "0 auto 18px";
      pageWrap.style.background = "#fff";
      pagesContainer.appendChild(pageWrap);

      const viewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.min(pagesContainer.clientWidth, maxWidth);
      const scale = availableWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });

      canvas.width = Math.floor(scaledViewport.width);
      canvas.height = Math.floor(scaledViewport.height);
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.pointerEvents = "none";
      pageWrap.appendChild(canvas);

      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
        background: "white",
      }).promise;

      renderedAnyPage = true;

      // Overlay layer for clickable links
      const annLayer = document.createElement("div");
      annLayer.className = "proland-annotation-layer";
      annLayer.style.position = "absolute";
      annLayer.style.left = "0";
      annLayer.style.top = "0";
      annLayer.style.width = canvas.width + "px";
      annLayer.style.height = canvas.height + "px";
      annLayer.style.transformOrigin = "0 0";
      annLayer.style.pointerEvents = "auto";
      annLayer.style.zIndex = "10";
      pageWrap.appendChild(annLayer);

      // Get annotations and create overlays
      const annotations = await page.getAnnotations({ intent: "display" });

      // Useful one-time debug (comment out later)
      console.log(`[ProLand PDF Embed] Page ${pageNum} annotations:`, annotations);

      const linkCount = buildLinkOverlays({
        annLayer,
        annotations,
        viewport: scaledViewport,
      });

      // Keep overlays aligned on responsive resize
      const resize = () => {
        const displayedWidth = pageWrap.clientWidth;
        const factor = displayedWidth / canvas.width;
        annLayer.style.transform = `scale(${factor})`;
      };
      resize();

      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(resize).observe(pageWrap);
      } else {
        window.addEventListener("resize", resize, { passive: true });
      }

      // If there were no links detected, that’s fine — PDF may not contain URL annotations
      if (linkCount === 0) {
        console.warn(`[ProLand PDF Embed] No URL annotations found on page ${pageNum}.`);
      }
    }
  } catch (err) {
    console.error("ProLand PDF Embed: render failed.", err);

    if (!renderedAnyPage) {
      setStatus(root, `Could not display PDF. <a href="${pdfUrl}">Open the PDF</a>.`);
    } else {
      clearStatus(root);
    }
  }
}

function init() {
  document.querySelectorAll(".proland-pdf-embed").forEach((el) => {
    renderEmbed(el);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
