export function clearSearchHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll('mark.md-search-hit');
  if (marks.length === 0) return;

  const parentsToNormalize = new Set<Node>();
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    const textNode = document.createTextNode(mark.textContent || '');
    parent.replaceChild(textNode, mark);
    parentsToNormalize.add(parent);
  });

  parentsToNormalize.forEach((parent) => {
    parent.normalize();
  });
}

export function applySearchHighlights(
  container: HTMLElement,
  query: string,
  caseSensitive: boolean
): HTMLElement[] {
  clearSearchHighlights(container);

  const trimmed = query.trim();
  if (!trimmed) return [];

  const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const targetNodes: Text[] = [];

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const parent = textNode.parentElement;
    const ignored = parent?.closest(
      'script, style, mark.md-search-hit, .code-copy-btn, .mermaid, .mermaid-zoom-wrapper, .mermaid-zoom-controls, [aria-hidden="true"]'
    );
    if (!ignored && textNode.textContent) {
      const hay = caseSensitive
        ? textNode.textContent
        : textNode.textContent.toLowerCase();
      if (hay.includes(needle)) {
        targetNodes.push(textNode);
      }
    }
    current = walker.nextNode();
  }

  const hits: HTMLElement[] = [];

  for (const textNode of targetNodes) {
    const text = textNode.textContent || '';
    const compareText = caseSensitive ? text : text.toLowerCase();
    let cursor = 0;
    let matchIdx = compareText.indexOf(needle, cursor);

    if (matchIdx === -1) continue;

    const fragment = document.createDocumentFragment();
    while (matchIdx !== -1) {
      if (matchIdx > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, matchIdx)));
      }
      const mark = document.createElement('mark');
      mark.className = 'md-search-hit';
      mark.dataset.hitIndex = String(hits.length);
      mark.textContent = text.slice(matchIdx, matchIdx + trimmed.length);
      fragment.appendChild(mark);
      hits.push(mark);

      cursor = matchIdx + trimmed.length;
      matchIdx = compareText.indexOf(needle, cursor);
    }

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return hits;
}

export function setActiveSearchHit(
  hits: HTMLElement[],
  activeIndex: number,
  scrollContainer?: HTMLElement | null
): void {
  hits.forEach((hit, idx) => {
    if (idx === activeIndex) {
      hit.classList.add('is-active');
    } else {
      hit.classList.remove('is-active');
    }
  });

  const target = hits[activeIndex];
  if (!target) return;

  if (scrollContainer) {
    const targetRect = target.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const offsetTop =
      targetRect.top -
      containerRect.top +
      scrollContainer.scrollTop -
      containerRect.height / 2 +
      targetRect.height / 2;

    scrollContainer.scrollTo({
      top: Math.max(0, offsetTop),
      behavior: 'smooth',
    });
  } else {
    target.scrollIntoView({behavior: 'smooth', block: 'center'});
  }
}

export function countKeywordMatches(
  content: string,
  query: string,
  caseSensitive = false
): number {
  const q = query.trim();
  if (!q) return 0;
  const hay = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = hay.indexOf(needle, pos);
    if (idx === -1) break;
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}
