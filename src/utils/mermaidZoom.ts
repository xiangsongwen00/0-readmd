const ZOOM_CONFIG = {
  minScale: 0.25,
  maxScale: 4,
  scaleStep: 0.1,
  transitionDuration: 0,
  fitPadding: 20,
};

interface ZoomController {
  zoomToDiagram: () => void;
  fillCanvas: () => void;
  resetZoom: () => void;
  centerGraph: () => void;
  refresh: () => void;
}

interface ZoomWrapperElement extends HTMLDivElement {
  __mermaidZoomController?: ZoomController;
  __mermaidZoomCleanup?: () => void;
}

const MERMAID_EMBEDDED_CSS = `
  svg, .nodeLabel, .label, .edgeLabel, text {
    font-family: 'DM Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
  }
  .node.color-group-0 rect, .node.color-group-0 circle, .node.color-group-0 ellipse, .node.color-group-0 polygon { fill: #ffedd5 !important; stroke: #fdba74 !important; }
  .node.color-group-1 rect, .node.color-group-1 circle, .node.color-group-1 ellipse, .node.color-group-1 polygon { fill: #fef9c3 !important; stroke: #fde047 !important; }
  .node.color-group-2 rect, .node.color-group-2 circle, .node.color-group-2 ellipse, .node.color-group-2 polygon { fill: #dbeafe !important; stroke: #93c5fd !important; }
  .node.color-group-3 rect, .node.color-group-3 circle, .node.color-group-3 ellipse, .node.color-group-3 polygon { fill: #dcfce7 !important; stroke: #86efac !important; }
  .node.color-group-4 rect, .node.color-group-4 circle, .node.color-group-4 ellipse, .node.color-group-4 polygon { fill: #f3e8ff !important; stroke: #d8b4fe !important; }
  text, .nodeLabel, .label, .edgeLabel { font-size: 14px !important; }
`;

export function injectMermaidExportStyles(svg: SVGSVGElement): void {
  if (svg.querySelector('style[data-mermaid-export-style="true"]')) return;
  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.setAttribute('data-mermaid-export-style', 'true');
  styleEl.textContent = MERMAID_EMBEDDED_CSS;
  svg.insertBefore(styleEl, svg.firstChild);
}

function getSvgNaturalBox(svg: SVGSVGElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return {x: vb.x, y: vb.y, width: vb.width, height: vb.height};
  }

  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return {
        x: bbox.x - 12,
        y: bbox.y - 12,
        width: bbox.width + 24,
        height: bbox.height + 24,
      };
    }
  } catch {
    // Ignore getBBox failure
  }

  const attrW = parseFloat(svg.getAttribute('width') || '0');
  const attrH = parseFloat(svg.getAttribute('height') || '0');
  if (attrW > 0 && attrH > 0) {
    return {x: 0, y: 0, width: attrW, height: attrH};
  }

  const rect = svg.getBoundingClientRect();
  return {
    x: 0,
    y: 0,
    width: Math.max(400, Math.ceil(rect.width)),
    height: Math.max(240, Math.ceil(rect.height)),
  };
}

function canvasHasVisibleContent(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) return false;
    const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const step = Math.max(4, Math.floor(data.length / 6000) * 4);
    for (let i = 0; i < data.length; i += step) {
      if (data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function renderSvgDirectToCanvas(
  clonedSvg: SVGSVGElement,
  svgWidth: number,
  svgHeight: number,
  padding: number,
  exportScale: number
): Promise<HTMLCanvasElement | null> {
  const hostWidth = svgWidth + padding * 2;
  const hostHeight = svgHeight + padding * 2;
  const serialized = new XMLSerializer().serializeToString(clonedSvg);
  const svgBlob = new Blob([serialized], {type: 'image/svg+xml;charset=utf-8'});
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('SVG image load failed'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(hostWidth * exportScale));
    canvas.height = Math.max(1, Math.round(hostHeight * exportScale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(exportScale, exportScale);
    ctx.drawImage(img, padding, padding, svgWidth, svgHeight);

    // Verify neither tainted nor blank
    canvas.toDataURL('image/png');
    if (!canvasHasVisibleContent(canvas)) {
      return null;
    }
    return canvas;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/**
 * Render any Mermaid container cleanly at full unclipped scale into a crisp HTMLCanvasElement.
 * Avoids live wrapper clipping, CSS transform cropping, and hidden-frame zero-rect bugs.
 */
export async function exportMermaidContainerToCanvas(
  mermaidContainer: HTMLElement,
  maxSidePx = 2800
): Promise<HTMLCanvasElement | null> {
  const liveSvg = mermaidContainer.querySelector('svg');
  if (!liveSvg) return null;

  const box = getSvgNaturalBox(liveSvg);
  const svgWidth = Math.max(1, Math.ceil(box.width));
  const svgHeight = Math.max(1, Math.ceil(box.height));
  const padding = 24;
  const hostWidth = svgWidth + padding * 2;
  const hostHeight = svgHeight + padding * 2;

  const baseSide = Math.max(1, hostWidth, hostHeight);
  let exportScale = Math.max(2, Math.min(4, maxSidePx / baseSide));
  const maxArea = 64000000;
  if (hostWidth * hostHeight * exportScale * exportScale > maxArea) {
    exportScale = Math.max(1.2, Math.sqrt(maxArea / (hostWidth * hostHeight)));
  }

  const clonedSvg = liveSvg.cloneNode(true) as SVGSVGElement;
  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clonedSvg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  clonedSvg.setAttribute('width', String(svgWidth));
  clonedSvg.setAttribute('height', String(svgHeight));
  Object.assign(clonedSvg.style, {
    transform: 'none',
    transition: 'none',
    display: 'block',
    width: `${svgWidth}px`,
    height: `${svgHeight}px`,
    minWidth: '0',
    maxWidth: 'none',
    margin: '0',
  });
  injectMermaidExportStyles(clonedSvg);

  // Fast vector SVG rasterization path first
  const directCanvas = await renderSvgDirectToCanvas(
    clonedSvg,
    svgWidth,
    svgHeight,
    padding,
    exportScale
  );
  if (directCanvas) {
    return directCanvas;
  }

  // Fallback: unclipped off-screen DOM capture via html2canvas
  const exportHost = document.createElement('div');
  exportHost.className = 'mermaid';
  Object.assign(exportHost.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${hostWidth}px`,
    height: `${hostHeight}px`,
    padding: `${padding}px`,
    margin: '0',
    border: 'none',
    borderRadius: '0',
    background: '#ffffff',
    boxSizing: 'border-box',
    overflow: 'visible',
    zIndex: '-1',
    pointerEvents: 'none',
  });
  exportHost.appendChild(clonedSvg);
  document.body.appendChild(exportHost);

  try {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    const {default: html2canvas} = await import('html2canvas');
    const canvas = await html2canvas(exportHost, {
      scale: exportScale,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: hostWidth,
      height: hostHeight,
      windowWidth: hostWidth,
      windowHeight: hostHeight,
    });

    return canvas;
  } finally {
    exportHost.remove();
  }
}

export function fitAllMermaidToDiagram(root: ParentNode = document): void {
  const wrappers = Array.from(
    root.querySelectorAll<ZoomWrapperElement>('.mermaid-zoom-wrapper')
  );
  wrappers.forEach((wrapper) => {
    wrapper.__mermaidZoomController?.zoomToDiagram();
  });
}

export function fillAllMermaidToCanvas(root: ParentNode = document): void {
  const wrappers = Array.from(
    root.querySelectorAll<ZoomWrapperElement>('.mermaid-zoom-wrapper')
  );
  wrappers.forEach((wrapper) => {
    wrapper.__mermaidZoomController?.fillCanvas();
  });
}

export function refreshAllMermaidOverlays(root: ParentNode = document): void {
  const wrappers = Array.from(
    root.querySelectorAll<ZoomWrapperElement>('.mermaid-zoom-wrapper')
  );
  wrappers.forEach((wrapper) => {
    wrapper.__mermaidZoomController?.refresh();
  });
}

export function cleanupMermaidZoom(root: ParentNode = document): void {
  const wrappers = Array.from(
    root.querySelectorAll<ZoomWrapperElement>('.mermaid-zoom-wrapper')
  );
  wrappers.forEach((wrapper) => {
    wrapper.__mermaidZoomCleanup?.();
  });
}

export function initMermaidZoom(root: ParentNode = document): void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>('.mermaid'));
  containers.forEach((mermaidContainer) => {
    if (mermaidContainer.closest('.mermaid-zoom-wrapper')) return;
    if (!mermaidContainer.dataset.zoomInitialized) {
      setupMermaidZoom(mermaidContainer);
    }
  });
}

function setupMermaidZoom(mermaidContainer: HTMLElement): void {
  if (mermaidContainer.closest('.mermaid-zoom-wrapper')) {
    mermaidContainer.dataset.zoomInitialized = 'true';
    return;
  }

  const svg = mermaidContainer.querySelector('svg');
  if (!svg || !mermaidContainer.parentNode) return;

  const wrapper = document.createElement('div') as ZoomWrapperElement;
  wrapper.className = 'mermaid-zoom-wrapper';

  const controls = document.createElement('div');
  controls.className = 'mermaid-zoom-controls';
  controls.innerHTML = `
    <button class="zoom-btn zoom-in" title="放大 (+)" type="button">+</button>
    <button class="zoom-btn zoom-out" title="缩小 (-)" type="button">−</button>
    <button class="zoom-btn zoom-reset" title="重置 (R)" type="button">R</button>
    <button class="zoom-btn zoom-fit" title="适应图表 (S)" type="button">S</button>
    <button class="zoom-btn zoom-fill" title="填充画布 (F)" type="button">F</button>
    <button class="zoom-btn zoom-center" title="居中 (C)" type="button">C</button>
    <button class="zoom-btn zoom-export" title="导出 PNG (E)" type="button">PNG</button>
    <span class="zoom-level">100%</span>
  `;

  const frame = document.createElement('div');
  frame.className = 'mermaid-focus-frame';

  const guides = document.createElement('div');
  guides.className = 'mermaid-canvas-guides';

  mermaidContainer.parentNode.insertBefore(wrapper, mermaidContainer);
  wrapper.appendChild(mermaidContainer);
  wrapper.appendChild(frame);
  wrapper.appendChild(guides);
  wrapper.appendChild(controls);

  mermaidContainer.dataset.zoomInitialized = 'true';

  let layoutObserver: ResizeObserver | null = null;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  svg.style.transformOrigin = '0 0';
  svg.style.transition = `transform ${ZOOM_CONFIG.transitionDuration}ms ease`;
  svg.style.cursor = 'grab';
  svg.style.userSelect = 'none';

  const zoomLevel = controls.querySelector('.zoom-level');
  const envelopePadding = 8;

  function getViewportBoundsInWrapper() {
    const w = Math.max(120, wrapper.clientWidth);
    const h = Math.max(120, wrapper.clientHeight);
    // Reserve top space for floating controls so the top node is never covered
    const topReserve = 48;
    const padX = 16;
    const padBottom = 16;
    return {
      left: padX,
      top: topReserve,
      width: Math.max(40, w - padX * 2),
      height: Math.max(40, h - topReserve - padBottom),
    };
  }

  function getGraphBoundsInWrapper() {
    const wrapperRect = wrapper.getBoundingClientRect();
    const candidates = Array.from(
      svg!.querySelectorAll('.node, .cluster, .edgePath, .edgeLabel, .flowchart-link, .label')
    );
    let minLeft = Number.POSITIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      minLeft = Math.min(minLeft, rect.left);
      minTop = Math.min(minTop, rect.top);
      maxRight = Math.max(maxRight, rect.right);
      maxBottom = Math.max(maxBottom, rect.bottom);
    }

    if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) {
      const svgRect = svg!.getBoundingClientRect();
      if (!svgRect.width || !svgRect.height) return null;
      return {
        left: svgRect.left - wrapperRect.left,
        top: svgRect.top - wrapperRect.top,
        width: svgRect.width,
        height: svgRect.height,
      };
    }

    return {
      left: minLeft - wrapperRect.left,
      top: minTop - wrapperRect.top,
      width: maxRight - minLeft,
      height: maxBottom - minTop,
    };
  }

  function syncFocusFrame() {
    const graphBounds = getGraphBoundsInWrapper();
    if (!graphBounds) return;
    frame.style.left = `${Math.max(8, graphBounds.left - envelopePadding)}px`;
    frame.style.top = `${Math.max(8, graphBounds.top - envelopePadding)}px`;
    frame.style.width = `${Math.min(wrapper.clientWidth - 16, graphBounds.width + envelopePadding * 2)}px`;
    frame.style.height = `${Math.min(wrapper.clientHeight - 16, graphBounds.height + envelopePadding * 2)}px`;
  }

  function syncCanvasGuides() {
    const wrapperW = wrapper.clientWidth;
    const wrapperH = wrapper.clientHeight;
    guides.style.left = '12px';
    guides.style.top = '12px';
    guides.style.width = `${Math.max(0, wrapperW - 24)}px`;
    guides.style.height = `${Math.max(0, wrapperH - 24)}px`;
  }

  function evaluateAlignment() {
    const graphBounds = getGraphBoundsInWrapper();
    const viewportBounds = getViewportBoundsInWrapper();
    if (!graphBounds) return;
    const graphCenterX = graphBounds.left + graphBounds.width / 2;
    const graphCenterY = graphBounds.top + graphBounds.height / 2;
    const viewCenterX = viewportBounds.left + viewportBounds.width / 2;
    const viewCenterY = viewportBounds.top + viewportBounds.height / 2;
    const aligned =
      Math.abs(graphCenterX - viewCenterX) < 4 && Math.abs(graphCenterY - viewCenterY) < 4;
    wrapper.classList.toggle('is-centered', aligned);
  }

  function updateTransform() {
    svg!.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`;
    if (zoomLevel) {
      zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    }
    syncFocusFrame();
    syncCanvasGuides();
    evaluateAlignment();
  }

  function runWithoutTransition(callback: () => void) {
    const previousTransition = svg!.style.transition;
    svg!.style.transition = 'none';
    callback();
    void svg!.getBoundingClientRect();
    svg!.style.transition = previousTransition;
  }

  function centerGraphStable() {
    const graphBounds = getGraphBoundsInWrapper();
    const viewportBounds = getViewportBoundsInWrapper();
    if (!graphBounds) return;

    const viewCenterX = viewportBounds.left + viewportBounds.width / 2;
    const viewCenterY = viewportBounds.top + viewportBounds.height / 2;
    const graphCenterX = graphBounds.left + graphBounds.width / 2;
    const graphCenterY = graphBounds.top + graphBounds.height / 2;

    translateX += viewCenterX - graphCenterX;
    translateY += viewCenterY - graphCenterY;
    updateTransform();
  }

  function getBaseGraphBounds(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const prev = {scale, translateX, translateY};
    let bounds: {left: number; top: number; width: number; height: number} | null = null;
    runWithoutTransition(() => {
      scale = 1;
      translateX = 0;
      translateY = 0;
      svg!.style.transform = 'matrix(1, 0, 0, 1, 0, 0)';
      bounds = getGraphBoundsInWrapper();
      scale = prev.scale;
      translateX = prev.translateX;
      translateY = prev.translateY;
      svg!.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`;
    });
    return bounds;
  }

  function computeContainScale(
    graphBounds: {width: number; height: number},
    viewportBounds: {width: number; height: number}
  ) {
    const safeWidth = Math.max(20, viewportBounds.width - ZOOM_CONFIG.fitPadding);
    const safeHeight = Math.max(20, viewportBounds.height - ZOOM_CONFIG.fitPadding);
    return Math.min(
      ZOOM_CONFIG.maxScale,
      Math.max(
        ZOOM_CONFIG.minScale,
        Math.min(safeWidth / graphBounds.width, safeHeight / graphBounds.height)
      )
    );
  }

  function applyScaleToCenterGraph(nextScale: number) {
    scale = Math.max(ZOOM_CONFIG.minScale, Math.min(ZOOM_CONFIG.maxScale, nextScale));
    updateTransform();
    centerGraphStable();
  }

  function zoom(delta: number, mouseX: number, mouseY: number) {
    const newScale = Math.max(
      ZOOM_CONFIG.minScale,
      Math.min(ZOOM_CONFIG.maxScale, scale + delta)
    );
    if (newScale === scale) return;

    const rect = wrapper.getBoundingClientRect();
    const x = mouseX - rect.left;
    const y = mouseY - rect.top;
    const scaleFactor = newScale / scale;
    translateX = x - (x - translateX) * scaleFactor;
    translateY = y - (y - translateY) * scaleFactor;
    scale = newScale;
    updateTransform();
  }

  function resetZoom() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    updateTransform();
    centerGraphStable();
  }

  function fillCanvas() {
    const graphBounds = getBaseGraphBounds();
    const viewportBounds = getViewportBoundsInWrapper();
    if (!graphBounds || graphBounds.width <= 0 || graphBounds.height <= 0) {
      centerGraphStable();
      return;
    }
    const containScale = computeContainScale(graphBounds, viewportBounds);
    applyScaleToCenterGraph(containScale);
  }

  function zoomToDiagram() {
    const previousScale = scale;
    const graphBounds = getBaseGraphBounds();
    const viewportBounds = getViewportBoundsInWrapper();
    if (!graphBounds || graphBounds.width <= 0 || graphBounds.height <= 0) {
      centerGraphStable();
      return;
    }
    const containScale = computeContainScale(graphBounds, viewportBounds);
    const adaptiveScale = Math.min(previousScale, containScale);
    applyScaleToCenterGraph(adaptiveScale);
  }

  async function exportImage() {
    const exportBtn = controls.querySelector<HTMLButtonElement>('.zoom-export');
    if (!exportBtn) return;
    const originalText = exportBtn.textContent;
    exportBtn.textContent = '...';
    exportBtn.disabled = true;

    try {
      const canvas = await exportMermaidContainerToCanvas(mermaidContainer, 3600);
      if (!canvas) {
        throw new Error('未能生成流程图画布');
      }

      await new Promise<void>((resolve) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `mermaid-diagram-${Date.now()}.png`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              URL.revokeObjectURL(url);
            }
            resolve();
          },
          'image/png',
          1
        );
      });
    } catch (error) {
      console.error('导出 Mermaid 图表失败:', error);
    } finally {
      exportBtn.textContent = originalText;
      exportBtn.disabled = false;
    }
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -ZOOM_CONFIG.scaleStep : ZOOM_CONFIG.scaleStep;
    zoom(delta, event.clientX, event.clientY);
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    isDragging = true;
    startX = event.clientX - translateX;
    startY = event.clientY - translateY;
    svg.style.cursor = 'grabbing';
    event.preventDefault();
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!isDragging) return;
    translateX = event.clientX - startX;
    translateY = event.clientY - startY;
    updateTransform();
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    svg.style.cursor = 'grab';
  };

  wrapper.addEventListener('wheel', onWheel, {passive: false});
  svg.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  controls.querySelector('.zoom-in')?.addEventListener('click', () => {
    const rect = wrapper.getBoundingClientRect();
    zoom(ZOOM_CONFIG.scaleStep * 2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  controls.querySelector('.zoom-out')?.addEventListener('click', () => {
    const rect = wrapper.getBoundingClientRect();
    zoom(-ZOOM_CONFIG.scaleStep * 2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  controls.querySelector('.zoom-reset')?.addEventListener('click', resetZoom);
  controls.querySelector('.zoom-fit')?.addEventListener('click', zoomToDiagram);
  controls.querySelector('.zoom-fill')?.addEventListener('click', fillCanvas);
  controls.querySelector('.zoom-center')?.addEventListener('click', centerGraphStable);
  controls.querySelector('.zoom-export')?.addEventListener('click', exportImage);
  svg.addEventListener('dblclick', resetZoom);

  wrapper.setAttribute('tabindex', '0');
  wrapper.addEventListener('keydown', (event) => {
    const rect = wrapper.getBoundingClientRect();
    if (event.key === 'c' || event.key === 'C') centerGraphStable();
    else if (event.key === 'r' || event.key === 'R') resetZoom();
    else if (event.key === 'e' || event.key === 'E') exportImage();
    else if (event.key === 's' || event.key === 'S') zoomToDiagram();
    else if (event.key === 'f' || event.key === 'F') fillCanvas();
    else if (event.key === '+' || event.key === '=') {
      zoom(ZOOM_CONFIG.scaleStep * 2, rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else if (event.key === '-') {
      zoom(-ZOOM_CONFIG.scaleStep * 2, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  });

  wrapper.__mermaidZoomController = {
    zoomToDiagram,
    fillCanvas,
    resetZoom,
    centerGraph: centerGraphStable,
    refresh() {
      syncFocusFrame();
      syncCanvasGuides();
      evaluateAlignment();
    },
  };

  const initialZoom = setTimeout(zoomToDiagram, 80);

  const syncAndCenter = () => {
    syncFocusFrame();
    syncCanvasGuides();
    evaluateAlignment();
  };

  syncAndCenter();
  window.addEventListener('resize', syncAndCenter, {passive: true});

  if (typeof ResizeObserver !== 'undefined') {
    layoutObserver = new ResizeObserver(syncAndCenter);
    layoutObserver.observe(wrapper);
    layoutObserver.observe(mermaidContainer);
    layoutObserver.observe(svg);
  }

  wrapper.__mermaidZoomCleanup = () => {
    clearTimeout(initialZoom);
    window.removeEventListener('resize', syncAndCenter);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    layoutObserver?.disconnect();
    layoutObserver = null;
  };
}
