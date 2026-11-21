import type {FolderTreeNode, MarkdownDoc, TocItem} from '../types/docs.js';

export interface ParsedTocResult {
  items: TocItem[];
  flatCount: number;
  parentMap: Record<string, string | null>;
}

export function syncTocFromDom(contentEl: HTMLElement): ParsedTocResult {
  const headings = Array.from(
    contentEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
  );
  const flatHeadings: Array<{id: string; level: number; text: string}> = [];

  headings.forEach((heading, idx) => {
    const id = heading.id || `heading-${idx + 1}`;
    heading.id = id;
    const level = Number(heading.tagName.slice(1)) || 1;
    const text = (heading.textContent || '').trim();
    if (text) {
      flatHeadings.push({id, level, text});
    }
  });

  const root: {level: number; id: string | null; children: TocItem[]} = {
    level: 0,
    id: null,
    children: [],
  };
  const stack: Array<{level: number; id: string | null; children: TocItem[]}> = [root];
  const parentMap: Record<string, string | null> = {};

  for (const heading of flatHeadings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const node: TocItem = {
      id: heading.id,
      level: heading.level,
      text: heading.text,
      children: [],
    };
    parent.children.push(node);
    parentMap[node.id] = parent.id;
    stack.push(node);
  }

  return {
    items: root.children,
    flatCount: flatHeadings.length,
    parentMap,
  };
}

export function filterTocTree(items: TocItem[], query: string): TocItem[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return items;
  return items.flatMap(item => {
    const children = filterTocTree(item.children, keyword);
    return item.text.toLowerCase().includes(keyword) || children.length ? [{ ...item, children }] : [];
  });
}

export function buildFolderTree(docs: MarkdownDoc[]): FolderTreeNode {
  const root: FolderTreeNode = {
    name: '',
    fullPath: '',
    folders: [],
    docs: [],
  };

  const folderMap = new Map<string, FolderTreeNode>();
  folderMap.set('', root);

  const ensureFolder = (folderPath: string): FolderTreeNode => {
    if (!folderPath) return root;
    const existing = folderMap.get(folderPath);
    if (existing) return existing;

    const parts = folderPath.split('/').filter(Boolean);
    let currentPath = '';
    let parent = root;

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let node = folderMap.get(currentPath);
      if (!node) {
        node = {
          name: part,
          fullPath: currentPath,
          folders: [],
          docs: [],
        };
        folderMap.set(currentPath, node);
        parent.folders.push(node);
      }
      parent = node;
    }
    return parent;
  };

  for (const doc of docs) {
    const folderNode = ensureFolder(doc.folder);
    folderNode.docs.push(doc);
  }

  return root;
}
