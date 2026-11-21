import type { MarkdownDoc } from './types/docs.js'

type LocalFile = { file: File; path: string }

async function filesFromEntry(entry: FileSystemEntry, parent = ''): Promise<LocalFile[]> {
  const path = parent + entry.name
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject)
    })
    return [{ file, path }]
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const entries: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    entries.push(...batch)
  }
  return (await Promise.all(entries.map(child => filesFromEntry(child, path + '/')))).flat()
}

export function pickedFiles(files: FileList): LocalFile[] {
  return Array.from(files, file => ({ file, path: file.webkitRelativePath || file.name }))
}

export async function droppedFiles(data: DataTransfer): Promise<LocalFile[]> {
  const files = pickedFiles(data.files)
  const entries = Array.from(data.items).filter(item => item.kind === 'file')
    .map(item => item.webkitGetAsEntry?.())
  if (!entries.length || entries.some(entry => !entry)) return files
  return (await Promise.all(entries.map(entry => filesFromEntry(entry)))).flat()
}

export async function readLocalDocs(files: LocalFile[]): Promise<MarkdownDoc[]> {
  const markdown = files.filter(({ file }) => /\.(md|markdown)$/i.test(file.name))
  const docs = await Promise.all(markdown.map(async ({ file, path }, index): Promise<MarkdownDoc> => ({
    id: 'local:' + index + ':' + path,
    path,
    relativePath: path,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    label: file.name.replace(/\.(md|markdown)$/i, ''),
    size: file.size,
    updatedAt: new Date(file.lastModified).toISOString(),
    content: await file.text(),
    source: 'local'
  })))
  return docs.sort((a, b) => a.folder.localeCompare(b.folder, 'zh-CN')
    || a.label.localeCompare(b.label, 'zh-CN'))
}
