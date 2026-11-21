import type { MarkdownDoc } from './types/docs.js';
export type MarkdownInput = Partial<MarkdownDoc> & Pick<MarkdownDoc, 'content'>;
export interface MarkdownEngineOptions {
    container?: string | HTMLElement;
    docs?: MarkdownInput[];
    defaultDocId?: string;
    directoryPicker?: HTMLElement;
    windowEvents?: boolean;
}
export interface MarkdownEngine {
    render(): void;
    setDocs(docs: MarkdownInput[], defaultDocId?: string): void;
    renderDocById(id: string): boolean;
    getDocs(): MarkdownDoc[];
    getCurrentDoc(): MarkdownDoc | null;
    destroy(): void;
}
export declare function createMarkdownDocsFromModules(modules: Record<string, unknown>): {
    path: string;
    label: string;
    content: string;
}[];
export declare function createMarkdownEngine(options?: MarkdownEngineOptions): MarkdownEngine;
