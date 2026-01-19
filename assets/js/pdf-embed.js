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

// Minimal link service shim for ESM builds where SimpleLinkService isn't exposed
function makeLinkService() {
  return {
    getDestinationHash(dest) {
      // internal destinations (not needed for external links)
      if (!dest) return "";
      return "#";
    },
    getAnchorUrl(hash) {
      return hash || "#";
    },
    goToDestination(dest) {
      // noop (we're not implementing internal navigation)
      // external URI links don't rely on this
    },
    executeNamedAction(action) {
      // noop
    },
  };
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

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      enableXfa: false,
    });

    const pdf = await loadingTask.promise;

    clearStatus(root);

    const annotationStorage = pdfjsLib.AnnotationStorage
      ? new pdfjsLib.AnnotationStorage()
      : null;

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

      // Annotation layer (links + widgets)
      try {
        const annLayer = document.createElement("div");
        annLayer.className = "annotationLayer";
        annLayer.style.position = "absolute";
        annLayer.style.left = "0";
        annLayer.style.top = "0";
        annLayer.style.width = canvas.width + "px";
        annLayer.style.height = canvas.height + "px";
        annLayer.style.transformOrigin = "0 0";
        annLayer.style.pointerEvents = "auto";
        annLayer.style.zIndex = "10";
        pageWrap.appendChild(annLayer);

        const annotations = await page.getAnnotations({ intent: "display" });

        // Use shim, since SimpleLinkService isn't available in your build
        const linkService = makeLinkService();

        const renderAnnotationMode =
          typeof pdfjsLib.AnnotationMode !== "undefined"
            ? pdfjsLib.AnnotationMode.ENABLE
            : 1;

        if (pdfjsLib.AnnotationLayer?.render) {
          const opts = {
            viewport: scaledViewport.clone({ dontFlip: true }),
            div: annLayer,
            annotations,
            page,
            linkService,
            renderForms: true,
            mimicDefaultAppearance: true,
            renderAnnotationMode,
          };

          // Some versions accept annotationStorage; include if available
          if (annotationStorage) opts.annotationStorage = annotationStorage;

          pdfjsLib.AnnotationLayer.render(opts);
        } else {
          console.warn("ProLand PDF Embed: AnnotationLayer.render not available in this PDF.js build.");
        }

        // Keep overlay aligned when responsive
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
      } catch (annErr) {
        console.warn("ProLand PDF Embed: annotation layer failed (links may not work).", annErr);
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
