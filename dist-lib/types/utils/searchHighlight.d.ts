export declare function clearSearchHighlights(container: HTMLElement): void;
export declare function applySearchHighlights(container: HTMLElement, query: string, caseSensitive: boolean): HTMLElement[];
export declare function setActiveSearchHit(hits: HTMLElement[], activeIndex: number, scrollContainer?: HTMLElement | null): void;
export declare function countKeywordMatches(content: string, query: string, caseSensitive?: boolean): number;
