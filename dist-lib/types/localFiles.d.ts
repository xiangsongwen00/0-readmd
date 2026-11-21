import type { MarkdownDoc } from './types/docs.js';
type LocalFile = {
    file: File;
    path: string;
};
export declare function pickedFiles(files: FileList): LocalFile[];
export declare function droppedFiles(data: DataTransfer): Promise<LocalFile[]>;
export declare function readLocalDocs(files: LocalFile[]): Promise<MarkdownDoc[]>;
export {};
