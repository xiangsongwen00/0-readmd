import type { FolderTreeNode, MarkdownDoc, TocItem } from '../types/docs.js';
export interface ParsedTocResult {
    items: TocItem[];
    flatCount: number;
    parentMap: Record<string, string | null>;
}
export declare function syncTocFromDom(contentEl: HTMLElement): ParsedTocResult;
export declare function filterTocTree(items: TocItem[], query: string): TocItem[];
export declare function buildFolderTree(docs: MarkdownDoc[]): FolderTreeNode;
