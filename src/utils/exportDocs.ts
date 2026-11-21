import {exportMermaidContainerToCanvas} from './mermaidZoom.js';

interface Interval {
  top: number;
  bottom: number;
}

interface PlannedPage {
  startDom: number;
  endDom: number;
}

function getDateStamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toContentInterval(
  rect: DOMRect,
  contentRect: DOMRect,
  padding = 0
): Interval {
  return {
    top: rect.top - contentRect.top - padding,
    bottom: rect.bottom - contentRect.top + padding,
  };
}

function mergeLineBands(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.bottom - interval.top > 1)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous) {
      const overlap = Math.min(previous.bottom, interval.bottom) - Math.max(previous.top, interval.top);
      const minHeight = Math.min(
        previous.bottom - previous.top,
        interval.bottom - interval.top
      );
      if (overlap > minHeight * 0.45) {
        previous.top = Math.min(previous.top, interval.top);
        previous.bottom = Math.max(previous.bottom, interval.bottom);
        continue;
      }
    }
    merged.push({...interval});
  }
  return merged;
}

function collectLineBands(content: HTMLElement, contentRect: DOMRect): Interval[] {
  const rawRects: Interval[] = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode() as Text | null;

  while (textNode) {
    const parent = textNode.parentElement;
    const ignored = parent?.closest(
      'script, style, svg, .code-copy-btn, .mermaid-zoom-controls, .pdf-pre-line, [aria-hidden="true"]'
    );
    if (!ignored && textNode.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0.5 && rect.height > 1) {
          rawRects.push(toContentInterval(rect, contentRect, 0));
        }
      }
      range.detach?.();
    }
    textNode = walker.nextNode() as Text | null;
  }

  // Treat each <pre> visual line as a tight non-overlapping line band
  content.querySelectorAll<HTMLElement>('.pdf-pre-line').forEach((lineEl) => {
    const lineRange = document.createRange();
    lineRange.selectNodeContents(lineEl);
    const lineRects = Array.from(lineRange.getClientRects()).filter(
      (r) => r.width > 0.5 && r.height > 1
    );
    lineRange.detach?.();

    if (lineRects.length > 0) {
      for (const rect of lineRects) {
        rawRects.push(toContentInterval(rect, contentRect, 0));
      }
    } else {
      const boxRect = lineEl.getBoundingClientRect();
      if (boxRect.width > 0.5 && boxRect.height > 1) {
        rawRects.push(toContentInterval(boxRect, contentRect, 0));
      }
    }
  });

  // Also include inline code badge boxes so borders/backgrounds are never grazed
  content.querySelectorAll<HTMLElement>('.pdf-code-pill').forEach((pill) => {
    const rect = pill.getBoundingClientRect();
    if (rect.width > 0.5 && rect.height > 1) {
      rawRects.push(toContentInterval(rect, contentRect, 0));
    }
  });

  return mergeLineBands(rawRects);
}

function collectAtomicBlocks(
  content: HTMLElement,
  contentRect: DOMRect,
  usableHeight: number
): Interval[] {
  const blocks: Interval[] = [];
  const candidates = content.querySelectorAll<HTMLElement>(
    'h1, h2, h3, h4, h5, h6, p, .pdf-list-row, tr, pre, blockquote, img, .pdf-mermaid-box, .pdf-missing-asset, hr'
  );

  candidates.forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Skip images already enclosed in .pdf-mermaid-box
    if (node.tagName === 'IMG' && node.closest('.pdf-mermaid-box')) return;

    const h = rect.height;
    let maxAllowed = usableHeight * 0.72;
    if (node.matches('.pdf-mermaid-box, img')) {
      maxAllowed = usableHeight * 0.94;
    } else if (node.matches('.pdf-list-row')) {
      if (node.querySelector('.pdf-normalized-list')) return;
      maxAllowed = usableHeight * 0.45;
    } else if (node.matches('blockquote')) {
      maxAllowed = usableHeight * 0.45;
    } else if (node.matches('pre')) {
      maxAllowed = usableHeight * 0.55;
    } else if (node.matches('p')) {
      maxAllowed = usableHeight * 0.3;
    }

    if (h <= maxAllowed) {
      blocks.push(toContentInterval(rect, contentRect, 0));
    }
  });

  return blocks;
}

function isLeadInParagraph(el: HTMLElement): boolean {
  if (el.tagName !== 'P') return false;
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0 || rect.height > 62) return false;
  const text = (el.textContent || '').trim();
  return text.length > 0 && text.length <= 100 && /[:：]$/.test(text);
}

function collectKeepWithNextGroups(
  content: HTMLElement,
  contentRect: DOMRect,
  usableHeight: number
): Interval[] {
  const groups: Interval[] = [];
  const triggers = Array.from(
    content.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, p')
  );
  const visited = new Set<HTMLElement>();

  for (const el of triggers) {
    if (visited.has(el)) continue;
    const isHeading = el.matches('h1, h2, h3, h4, h5, h6');
    if (!isHeading && !isLeadInParagraph(el)) continue;

    visited.add(el);
    const startRect = el.getBoundingClientRect();
    if (startRect.height <= 0) continue;

    const groupTop = startRect.top - contentRect.top;
    let groupBottom = startRect.bottom - contentRect.top;

    // Chain consecutive headings (e.g. h2 -> h3 -> content) until first content block
    let cursor: HTMLElement | null = el.nextElementSibling as HTMLElement | null;
    while (cursor && cursor.matches('h1, h2, h3, h4, h5, h6')) {
      visited.add(cursor);
      const r = cursor.getBoundingClientRect();
      if (r.height > 0) {
        groupBottom = Math.max(groupBottom, r.bottom - contentRect.top);
      }
      cursor = cursor.nextElementSibling as HTMLElement | null;
    }

    if (cursor) {
      const nextRect = cursor.getBoundingClientRect();
      if (nextRect.height > 0) {
        const nextTop = nextRect.top - contentRect.top;
        const nextBottom = nextRect.bottom - contentRect.top;

        if (
          !cursor.matches('table, .pdf-normalized-list') &&
          nextRect.height <= usableHeight * 0.44
        ) {
          // Keep small/medium follow-up block (like code examples / short paragraphs) whole with heading
          groupBottom = Math.max(groupBottom, nextBottom);
        } else {
          // For tall tables/lists/code blocks, keep heading attached to at least top 120px
          groupBottom = Math.max(groupBottom, Math.min(nextBottom, nextTop + 120));
        }
      }
    }

    if (groupBottom - groupTop <= usableHeight * 0.78) {
      groups.push({top: groupTop, bottom: groupBottom});
    }
  }

  return groups;
}

function planDomPages(content: HTMLElement, usableHeight: number): PlannedPage[] {
  const totalHeight = Math.max(1, content.scrollHeight);
  const contentRect = content.getBoundingClientRect();

  const lineBands = collectLineBands(content, contentRect);
  const atomicBlocks = collectAtomicBlocks(content, contentRect, usableHeight);
  const keepGroups = collectKeepWithNextGroups(content, contentRect, usableHeight);
  const tableRowTops = Array.from(content.querySelectorAll<HTMLElement>('tr')).map(
    (tr) => tr.getBoundingClientRect().top - contentRect.top
  );

  const protectedIntervals = [...keepGroups, ...atomicBlocks, ...lineBands];
  const pages: PlannedPage[] = [];
  let pageStart = 0;
  let guard = 0;

  while (pageStart < totalHeight - 1 && guard < 300) {
    guard += 1;
    const idealEnd = pageStart + usableHeight;

    if (idealEnd >= totalHeight - 1) {
      pages.push({startDom: pageStart, endDom: totalHeight});
      break;
    }

    let y = idealEnd;
    let iter = 0;
    while (iter++ < 500) {
      const crossing = protectedIntervals.filter(
        (item) =>
          item.top < y - 0.25 &&
          item.bottom > y + 0.25 &&
          item.top > pageStart + 20
      );
      if (crossing.length === 0) break;

      const earliestTop = Math.min(...crossing.map((item) => item.top));
      const candidateY = earliestTop - 0.25;
      if (candidateY <= pageStart + 20 || candidateY >= y - 0.05) break;
      y = candidateY;
    }

    // Refine y cleanly into the nearest inter-line / inter-block whitespace midpoint
    let prevBottom = pageStart + 20;
    for (const band of lineBands) {
      if (band.bottom <= y + 0.25 && band.bottom > prevBottom) {
        prevBottom = band.bottom;
      }
    }
    for (const block of atomicBlocks) {
      if (block.bottom <= y + 0.25 && block.bottom > prevBottom) {
        prevBottom = block.bottom;
      }
    }

    let nextTop = Number.POSITIVE_INFINITY;
    for (const band of lineBands) {
      if (band.top >= y - 0.25 && band.top < nextTop) {
        nextTop = band.top;
      }
    }
    for (const block of atomicBlocks) {
      if (block.top >= y - 0.25 && block.top < nextTop) {
        nextTop = block.top;
      }
    }

    let breakY = y;
    const matchedRowTop = tableRowTops.find((rt) => Math.abs(rt - y) < 6 && rt > pageStart + 20);
    if (matchedRowTop !== undefined) {
      // Slice right on the top edge of the next table row so its top border stays visible on the new page
      breakY = Math.max(pageStart + 20, matchedRowTop - 0.25);
    } else if (Number.isFinite(nextTop) && nextTop > prevBottom + 0.5) {
      breakY = Math.min(idealEnd, (prevBottom + nextTop) / 2);
    }

    // Strict invariant: NEVER cut through any individual text line or glyph band
    let lineGuard = 0;
    while (lineGuard++ < 300) {
      const splitBand = lineBands.find(
        (band) =>
          band.bottom - band.top < usableHeight * 0.75 &&
          band.top < breakY - 0.15 &&
          band.bottom > breakY + 0.15 &&
          band.top > pageStart + 16
      );
      if (!splitBand) break;

      let safePrevBottom = pageStart + 16;
      for (const b of lineBands) {
        if (b.bottom <= splitBand.top + 0.15 && b.bottom > safePrevBottom) {
          safePrevBottom = b.bottom;
        }
      }
      const nextBreak =
        splitBand.top > safePrevBottom + 0.2
          ? (safePrevBottom + splitBand.top) / 2
          : splitBand.top - 0.2;
      if (nextBreak >= breakY - 0.05 || nextBreak <= pageStart + 16) {
        break;
      }
      breakY = nextBreak;
    }

    if (breakY <= pageStart + 16) {
      breakY = Math.min(totalHeight, idealEnd);
    }

    pages.push({startDom: pageStart, endDom: breakY});
    pageStart = breakY;
  }

  return pages;
}

function normalizePreLinesForPdf(root: HTMLElement): void {
  const preBlocks = Array.from(root.querySelectorAll<HTMLElement>('pre'));
  for (const pre of preBlocks) {
    const codeEl = pre.querySelector('code');
    const target = (codeEl as HTMLElement | null) ?? pre;
    const raw = (target.textContent ?? '').replace(/\r\n/g, '\n');
    const trimmed = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    const lines = trimmed.split('\n');

    target.textContent = '';
    for (const line of lines) {
      const lineSpan = document.createElement('span');
      lineSpan.className = 'pdf-pre-line';
      lineSpan.textContent = line.length > 0 ? line : '\u00A0';
      target.appendChild(lineSpan);
    }
  }
}

/**
 * Classify inline <code> elements after DOM layout so short tokens render as crisp
 * inline-block pills without vertical metric shift, while long multi-line paths wrap cleanly.
 */
function classifyInlineCodeForPdf(root: HTMLElement): void {
  const codes = Array.from(root.querySelectorAll<HTMLElement>('code'));
  for (const code of codes) {
    if (code.closest('pre')) continue;
    const text = (code.textContent || '').trim();
    const rects = code.getClientRects();
    const isLongOrMultiline = rects.length > 1 || text.length > 44;

    if (isLongOrMultiline) {
      code.classList.add('pdf-code-wrap');
    } else {
      code.classList.add('pdf-code-pill');
    }
  }
}

/**
 * Convert native <ul>/<ol> markers into explicit flex-aligned spans inside the off-screen
 * print clone so html2canvas renders list numbers & bullets aligned with CJK text baselines.
 */
function normalizeListsForPdf(root: HTMLElement): void {
  const lists = Array.from(root.querySelectorAll<HTMLElement>('ul, ol'));

  lists.forEach((list) => {
    const isOrdered = list.tagName.toLowerCase() === 'ol';
    const startAttr = Number(list.getAttribute('start') || '1');
    let counter = Number.isFinite(startAttr) ? startAttr : 1;

    let depth = 0;
    let parent = list.parentElement;
    while (parent && parent !== root) {
      if (parent.matches('ul, ol')) depth += 1;
      parent = parent.parentElement;
    }

    list.classList.add('pdf-normalized-list');

    const items = Array.from(list.children).filter(
      (child): child is HTMLLIElement => child.tagName.toLowerCase() === 'li'
    );

    items.forEach((li) => {
      const markerText = isOrdered
        ? `${counter++}.`
        : depth === 0
          ? '•'
          : depth === 1
            ? '◦'
            : '▪';

      const row = document.createElement('div');
      row.className = 'pdf-list-row';

      const marker = document.createElement('span');
      marker.className = isOrdered ? 'pdf-list-marker is-ordered' : 'pdf-list-marker';
      marker.textContent = markerText;

      const body = document.createElement('div');
      body.className = 'pdf-list-body';

      while (li.firstChild) {
        body.appendChild(li.firstChild);
      }

      row.appendChild(marker);
      row.appendChild(body);
      li.replaceWith(row);
    });
  });
}

async function rasterizeMermaidForPdf(
  clone: HTMLElement,
  sourceContent: HTMLElement
): Promise<void> {
  const sourceBlocks = Array.from(sourceContent.querySelectorAll<HTMLElement>('.mermaid'));
  const cloneWrappers = Array.from(
    clone.querySelectorAll<HTMLElement>('.mermaid-zoom-wrapper, .mermaid')
  ).filter((el) => !el.parentElement?.closest('.mermaid-zoom-wrapper'));

  for (let idx = 0; idx < cloneWrappers.length; idx++) {
    const wrapper = cloneWrappers[idx];
    const sourceBlock = sourceBlocks[idx];
    const box = document.createElement('div');
    box.className = 'pdf-mermaid-box';

    if (sourceBlock) {
      try {
        const canvas = await exportMermaidContainerToCanvas(sourceBlock, 2200);
        if (canvas) {
          const img = document.createElement('img');
          img.src = canvas.toDataURL('image/png');
          img.alt = '流程图';
          img.style.width = 'auto';
          img.style.maxWidth = '100%';
          img.style.maxHeight = '1020px';
          img.style.height = 'auto';
          img.style.margin = '0 auto';
          img.style.border = 'none';
          box.appendChild(img);
          wrapper.replaceWith(box);
          continue;
        }
      } catch {
        // Fallback placeholder if rasterization failed
      }
    }

    const fallback = document.createElement('div');
    fallback.className = 'pdf-missing-asset';
    fallback.textContent = '流程图渲染导出失败';
    box.appendChild(fallback);
    wrapper.replaceWith(box);
  }
}

function sanitizeBrokenImagesForPdf(clone: HTMLElement, sourceContent: HTMLElement): void {
  const sourceImgs = Array.from(sourceContent.querySelectorAll<HTMLImageElement>('img'));
  const cloneImgs = Array.from(clone.querySelectorAll<HTMLImageElement>('img'));

  cloneImgs.forEach((img, idx) => {
    if (img.src.startsWith('data:image/')) return;
    const srcImg = sourceImgs[idx];
    const isBroken =
      !srcImg || !srcImg.complete || srcImg.naturalWidth === 0 || srcImg.naturalHeight === 0;
    if (isBroken) {
      const placeholder = document.createElement('div');
      placeholder.className = 'pdf-missing-asset';
      placeholder.textContent = img.alt ? `[图片资源不可用: ${img.alt}]` : '[图片资源不可用]';
      img.replaceWith(placeholder);
    }
  });
}

const PDF_STAGE_CSS = `
.pdf-print-stage {
  font-family: 'DM Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1e293b;
  background: #ffffff;
  font-size: 15px;
  line-height: 1.68;
  word-wrap: break-word;
}
.pdf-print-stage * {
  box-sizing: border-box;
}
.pdf-print-stage > *:first-child {
  margin-top: 0 !important;
}
.pdf-print-stage h1 {
  font-family: 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
  font-size: 23px;
  font-weight: 700;
  line-height: 1.3;
  color: #0f172a;
  margin: 0 0 14px;
  padding-bottom: 10px;
  border-bottom: 1.5px solid #cbd5e1;
}
.pdf-print-stage h2 {
  font-family: 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
  color: #0f172a;
  margin: 20px 0 10px;
  padding: 6px 12px;
  border-radius: 6px;
  background: #f1f5f3;
  border: 1px solid #dbe4de;
}
.pdf-print-stage h3 {
  font-family: 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: #0f172a;
  margin: 15px 0 7px;
  padding-bottom: 4px;
  border-bottom: 1px dashed #e2e8f0;
}
.pdf-print-stage h4 {
  font-size: 14.5px;
  font-weight: 600;
  color: #1e293b;
  margin: 12px 0 6px;
}
.pdf-print-stage h5,
.pdf-print-stage h6 {
  font-size: 14px;
  font-weight: 600;
  color: #475569;
  margin: 10px 0 4px;
}
.pdf-print-stage p {
  margin: 0 0 9px;
}
.pdf-print-stage a {
  color: #15803d;
  text-decoration: underline;
  text-decoration-color: rgba(21, 128, 61, 0.35);
}
.pdf-print-stage strong {
  color: #0f172a;
  font-weight: 600;
}
.pdf-print-stage hr {
  border: 0;
  height: 1px;
  background: #e2e8f0;
  margin: 16px 0;
}
.pdf-print-stage blockquote {
  margin: 10px 0;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid #dbe4de;
  background: #f6f9f7;
  color: #334155;
}
.pdf-print-stage blockquote > p:last-child {
  margin-bottom: 0;
}
.pdf-print-stage .pdf-normalized-list {
  list-style: none;
  margin: 6px 0 10px;
  padding-left: 0;
}
.pdf-print-stage .pdf-normalized-list .pdf-normalized-list {
  margin: 4px 0 4px;
  padding-left: 4px;
}
.pdf-print-stage .pdf-list-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 3.5px 0;
}
.pdf-print-stage .pdf-list-marker {
  flex: 0 0 auto;
  min-width: 16px;
  text-align: center;
  color: #475569;
  font-weight: 600;
  line-height: 1.68;
}
.pdf-print-stage .pdf-list-marker.is-ordered {
  min-width: 22px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pdf-print-stage .pdf-list-body {
  flex: 1 1 auto;
  min-width: 0;
}
.pdf-print-stage .pdf-list-body > p:last-child {
  margin-bottom: 0;
}
.pdf-print-stage .md-table-wrap {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  overflow: visible;
}
.pdf-print-stage table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13.5px;
  line-height: 1.65;
}
.pdf-print-stage thead {
  background: #f1f5f3;
}
.pdf-print-stage th {
  font-weight: 600;
  color: #0f172a;
  text-align: center;
  vertical-align: middle;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  white-space: nowrap;
}
.pdf-print-stage td {
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  text-align: center;
  vertical-align: middle;
  color: #1e293b;
}
.pdf-print-stage th[align='left'],
.pdf-print-stage td[align='left'] {
  text-align: left;
}
.pdf-print-stage th[align='right'],
.pdf-print-stage td[align='right'] {
  text-align: right;
}
.pdf-print-stage code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.2px;
  color: #14221a;
}
.pdf-print-stage code.pdf-code-pill {
  display: inline-block;
  background: #eef3ef;
  border: 1px solid #d5e0d8;
  padding: 2px 6px;
  border-radius: 3.5px;
  line-height: 1.35;
  vertical-align: middle;
  margin: 1px 0;
  max-width: 100%;
  white-space: normal;
  word-break: break-word;
}
.pdf-print-stage code.pdf-code-wrap {
  display: inline;
  background: transparent;
  border: none;
  padding: 0;
  color: #0f5132;
  font-weight: 500;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.pdf-print-stage h1 code,
.pdf-print-stage h2 code,
.pdf-print-stage h3 code,
.pdf-print-stage h4 code {
  font-size: 0.88em;
}
.pdf-print-stage pre {
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #1e293b;
  border-radius: 7px;
  padding: 10px 12px;
  margin: 10px 0;
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.pdf-print-stage pre > code {
  display: block;
  background: transparent;
  border: none;
  color: inherit;
  padding: 0;
  font-size: inherit;
}
.pdf-print-stage .pdf-pre-line {
  display: block;
  margin: 0;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.pdf-print-stage img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  margin: 10px auto;
  display: block;
}
.pdf-print-stage .pdf-mermaid-box {
  margin: 14px 0;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  text-align: center;
}
.pdf-print-stage .pdf-missing-asset {
  margin: 10px 0;
  padding: 10px 14px;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12.5px;
  text-align: center;
}
`;

export async function exportContentToPdf(
  content: HTMLElement,
  docLabel: string
): Promise<void> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const stageWidthPx = 840;
  const stageHost = document.createElement('div');
  Object.assign(stageHost.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${stageWidthPx}px`,
    background: '#ffffff',
    zIndex: '-1',
    pointerEvents: 'none',
  });

  const stageStyle = document.createElement('style');
  stageStyle.textContent = PDF_STAGE_CSS;

  const clone = content.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.className = 'pdf-print-stage';
  clone.style.width = `${stageWidthPx}px`;

  clone.querySelectorAll('.code-copy-btn, [data-pdf-page-spacer]').forEach((el) => {
    el.remove();
  });
  clone.querySelectorAll('mark.md-search-hit').forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
  });

  sanitizeBrokenImagesForPdf(clone, content);
  await rasterizeMermaidForPdf(clone, content);
  normalizeListsForPdf(clone);
  normalizePreLinesForPdf(clone);

  stageHost.appendChild(stageStyle);
  stageHost.appendChild(clone);
  document.body.appendChild(stageHost);

  // html2canvas runs `new FontMetrics(document)` directly against the live `document.body`.
  // Tailwind v4 Preflight's `img { display: block }` forces the internal 1x1 test <img> onto
  // a new line below `Hidden Text`, inflating measured baseline by +6..+8px across ALL text.
  const liveMetricsStyle = document.createElement('style');
  liveMetricsStyle.setAttribute('data-html2canvas-metrics-fix', 'true');
  liveMetricsStyle.textContent = `
    body > div[style*="visibility: hidden"][style*="white-space: nowrap"] {
      line-height: normal !important;
    }
    body > div[style*="visibility: hidden"][style*="white-space: nowrap"] img {
      display: inline !important;
      vertical-align: baseline !important;
    }
  `;
  document.head.appendChild(liveMetricsStyle);

  try {
    const cloneImgs = Array.from(clone.querySelectorAll<HTMLImageElement>('img'));
    await Promise.all(
      cloneImgs.map((img) =>
        img.decode ? img.decode().catch(() => undefined) : Promise.resolve()
      )
    );

    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    classifyInlineCodeForPdf(clone);

    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    const [{default: html2canvas}, {jsPDF}] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    const pdf = new jsPDF({orientation: 'p', unit: 'pt', format: 'a4', compress: true});
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const marginX = 36;
    const marginTop = 36;
    const marginBottom = 40;
    const printableWidth = pageWidth - marginX * 2;
    const printableHeight = pageHeight - marginTop - marginBottom;

    const usablePageHeightDom = Math.floor(
      (stageWidthPx * printableHeight) / printableWidth
    ) - 1;

    const plannedPages = planDomPages(clone, usablePageHeightDom);
    const captureScale = 2;
    const totalContentHeight = Math.max(1, clone.scrollHeight);
    const maxChunkDomHeight = usablePageHeightDom * 6;
    const pageImages: string[] = [];

    const pageCanvas = document.createElement('canvas');
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) throw new Error('Canvas context initialization failed');

    // Group consecutive planned pages into chunks safely under Chromium's canvas height limit
    let pageIdx = 0;
    while (pageIdx < plannedPages.length) {
      const chunkStartDom = plannedPages[pageIdx].startDom;
      let chunkEndIdx = pageIdx;

      while (
        chunkEndIdx + 1 < plannedPages.length &&
        plannedPages[chunkEndIdx + 1].endDom - chunkStartDom <= maxChunkDomHeight
      ) {
        chunkEndIdx += 1;
      }

      const chunkEndDom = plannedPages[chunkEndIdx].endDom;
      const chunkDomHeight = Math.max(1, chunkEndDom - chunkStartDom);

      const chunkCanvas = await html2canvas(clone, {
        scale: captureScale,
        useCORS: true,
        backgroundColor: '#ffffff',
        x: 0,
        y: chunkStartDom,
        width: stageWidthPx,
        height: chunkDomHeight,
        scrollX: 0,
        scrollY: 0,
        windowWidth: stageWidthPx,
        windowHeight: totalContentHeight,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.style.overflow = 'visible';
          clonedDoc.documentElement.style.height = 'auto';
          clonedDoc.body.style.overflow = 'visible';
          clonedDoc.body.style.height = 'auto';

          // Tailwind v4 Preflight sets `img { display: block }`, which pushes html2canvas's
          // internal FontMetrics 1x1 test <img> onto a new line and shifts every text baseline
          // downward by ~5-8px. Restore inline baseline for test <img> while keeping block for stage imgs.
          const fontMetricsFix = clonedDoc.createElement('style');
          fontMetricsFix.textContent = `
            img {
              display: inline !important;
              vertical-align: baseline !important;
            }
            .pdf-print-stage img {
              display: block !important;
              vertical-align: middle !important;
            }
          `;
          clonedDoc.head.appendChild(fontMetricsFix);
        },
      });

      const usablePageHeightPx = Math.floor(
        (chunkCanvas.width * printableHeight) / printableWidth
      );

      for (let i = pageIdx; i <= chunkEndIdx; i++) {
        const p = plannedPages[i];
        const srcY = Math.max(0, Math.round((p.startDom - chunkStartDom) * captureScale));
        const rawSrcH = Math.max(1, Math.round((p.endDom - p.startDom) * captureScale));
        const srcH = Math.min(chunkCanvas.height - srcY, usablePageHeightPx, rawSrcH);

        pageCanvas.width = chunkCanvas.width;
        pageCanvas.height = usablePageHeightPx;
        pageCtx.clearRect(0, 0, chunkCanvas.width, usablePageHeightPx);
        pageCtx.fillStyle = '#ffffff';
        pageCtx.fillRect(0, 0, chunkCanvas.width, usablePageHeightPx);

        if (srcH > 0) {
          pageCtx.drawImage(
            chunkCanvas,
            0,
            srcY,
            chunkCanvas.width,
            srcH,
            0,
            0,
            chunkCanvas.width,
            srcH
          );
        }
        pageImages.push(pageCanvas.toDataURL('image/jpeg', 0.94));
      }

      pageIdx = chunkEndIdx + 1;
    }

    const totalPages = Math.max(1, pageImages.length);
    pageImages.forEach((imgData, i) => {
      if (i > 0) pdf.addPage();
      pdf.addImage(
        imgData,
        'JPEG',
        marginX,
        marginTop,
        printableWidth,
        printableHeight
      );
      pdf.setFontSize(8.5);
      pdf.setTextColor(130, 140, 134);
      pdf.text(`${i + 1} / ${totalPages}`, pageWidth - marginX, pageHeight - 18, {
        align: 'right',
      });
    });

    const safeName = (docLabel || 'document').replace(/[\\/:*?"<>|]/g, '_');
    pdf.save(`${safeName}-${getDateStamp()}.pdf`);
  } finally {
    liveMetricsStyle.remove();
    stageHost.remove();
  }
}

async function captureMermaidImages(content: HTMLElement): Promise<string[]> {
  const mermaidBlocks = Array.from(content.querySelectorAll<HTMLElement>('.mermaid'));
  if (mermaidBlocks.length === 0) return [];

  const images: string[] = [];

  for (const block of mermaidBlocks) {
    try {
      const canvas = await exportMermaidContainerToCanvas(block, 2200);
      images.push(canvas ? canvas.toDataURL('image/png') : '');
    } catch {
      images.push('');
    }
  }
  return images;
}

function applyMermaidImagesToClone(container: HTMLElement, images: string[]): void {
  const mermaidBlocks = Array.from(container.querySelectorAll<HTMLElement>('.mermaid'));
  mermaidBlocks.forEach((block, index) => {
    const dataUrl = images[index];
    if (!dataUrl) return;
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.width = '100%';
    img.style.maxWidth = '14cm';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    block.style.textAlign = 'center';
    block.innerHTML = '';
    block.appendChild(img);
  });
}

function ensureTableCompatibility(container: HTMLElement): void {
  const tables = container.querySelectorAll('table');
  tables.forEach((table) => {
    table.setAttribute('border', '1');
    table.setAttribute('cellpadding', '0');
    table.setAttribute('cellspacing', '0');
    table.style.borderCollapse = 'collapse';
    table.style.width = '100%';

    const cells = table.querySelectorAll<HTMLElement>('th, td');
    cells.forEach((cell) => {
      const explicitAlign = cell.getAttribute('align');
      cell.style.border = '1px solid #cbd5e1';
      cell.style.padding = '7px 10px';
      cell.style.textAlign =
        explicitAlign === 'left' || explicitAlign === 'right' ? explicitAlign : 'center';
      cell.style.verticalAlign = 'middle';
    });
  });
}

function buildWordHtml(contentHtml: string, title: string): string {
  const styles = `
    @page { size: A4; margin: 2.2cm; }
    body { font-family: 'Microsoft YaHei', 'PingFang SC', Arial, sans-serif; font-size: 10.5pt; color: #1e293b; line-height: 1.65; }
    h1 { font-size: 18pt; font-weight: 700; color: #0f172a; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 1.5pt solid #cbd5e1; }
    h2 { font-size: 13.5pt; font-weight: 700; color: #0f172a; margin: 18pt 0 8pt; padding: 5pt 8pt; background: #f1f5f3; border: 1pt solid #dbe4de; }
    h3 { font-size: 11.5pt; font-weight: 600; color: #0f172a; margin: 14pt 0 6pt; }
    h4 { font-size: 10.5pt; font-weight: 600; color: #1e293b; margin: 10pt 0 4pt; }
    p { margin: 0 0 8pt; }
    ul, ol { padding-left: 20pt; margin: 4pt 0 8pt; }
    li { margin: 3pt 0; }
    blockquote { margin: 8pt 0; padding: 8pt 10pt; background: #f6f9f7; border: 1pt solid #dbe4de; color: #334155; }
    table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 9.5pt; }
    th, td { border: 1pt solid #cbd5e1; padding: 6pt 8pt; text-align: center; vertical-align: middle; }
    th[align="left"], td[align="left"] { text-align: left; }
    th[align="right"], td[align="right"] { text-align: right; }
    th { background: #f1f5f3; font-weight: 600; }
    pre { background: #f8fafc; border: 1pt solid #cbd5e1; padding: 8pt 10pt; font-size: 9pt; white-space: pre-wrap; }
    code { background: #eef3ef; padding: 1pt 3pt; font-size: 9.5pt; }
    a { color: #15803d; text-decoration: none; }
    img { max-width: 100%; height: auto; display: block; margin: 10pt auto; }
    .mermaid { text-align: center; }
  `;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>${styles}</style>
  </head>
  <body>
    ${contentHtml}
  </body>
</html>`;
}

export async function exportContentToWord(
  content: HTMLElement,
  docLabel: string
): Promise<void> {
  const clone = content.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      '.code-copy-btn, .mermaid-zoom-controls, .mermaid-focus-frame, .mermaid-canvas-guides'
    )
    .forEach((el) => {
      el.remove();
    });

  clone.querySelectorAll('mark.md-search-hit').forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
  });

  const mermaidImages = await captureMermaidImages(content);
  applyMermaidImagesToClone(clone, mermaidImages);
  ensureTableCompatibility(clone);

  const safeName = (docLabel || 'document').replace(/[\\/:*?"<>|]/g, '_');
  const html = buildWordHtml(clone.innerHTML, safeName);
  const blob = new Blob(['\ufeff', html], {type: 'application/msword'});
  triggerDownload(blob, `${safeName}-${getDateStamp()}.doc`);
}
