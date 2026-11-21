export interface MarkdownDoc {
  id?: string;
  path: string;
  relativePath?: string;
  folder: string;
  label: string;
  content: string;
  baseUrl?: string;
  size?: number;
  updatedAt?: string;
  source?: 'directory' | 'local';
}

export interface TocItem {
  id: string;
  level: number;
  text: string;
  children: TocItem[];
}

export interface FolderTreeNode {
  name: string;
  fullPath: string;
  folders: FolderTreeNode[];
  docs: MarkdownDoc[];
}
