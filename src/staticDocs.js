const markdownExtension = /\.(md|markdown)$/i

function childLinks(html, directory) {
  const listing = document.createElement('template')
  listing.innerHTML = html
  const children = new Map()
  for (const link of listing.content.querySelectorAll('a[href]')) {
    const url = new URL(link.getAttribute('href'), directory)
    if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname) || url.search || url.hash) continue
    const segment = url.pathname.slice(directory.pathname.length).replace(/\/$/, '')
    if (!segment || segment.includes('/')) continue
    const name = decodeURIComponent(segment)
    if (name.startsWith('.') || /[/\\]/.test(name)) continue
    children.set(name, url)
  }
  // IIS and common static servers return a listing even for an empty directory.
  if (!children.size && !listing.content.querySelector('pre')
    && !/^Index of /i.test(listing.content.querySelector('title')?.textContent || '')) {
    throw new Error('服务器未返回目录列表，请确认已启用该目录的目录浏览。')
  }
  return children
}

async function readDirectory(directory, signal, folder = '') {
  const response = await fetch(directory, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error('无法读取目录 ' + directory.pathname + '（HTTP ' + response.status + '）')
  const links = childLinks(await response.text(), directory)
  const entries = await Promise.all(Array.from(links, async ([name, url]) => {
    const path = folder ? folder + '/' + name : name
    if (url.pathname.endsWith('/')) return readDirectory(url, signal, path)
    if (!markdownExtension.test(name)) return []
    const file = await fetch(url, { signal, cache: 'no-store' })
    if (file.status === 404 || file.status === 410) return []
    if (!file.ok) throw new Error('无法读取文档 ' + path + '（HTTP ' + file.status + '）')
    const content = await file.text()
    return [{
      id: 'dir:' + path, path, relativePath: path, folder, content,
      label: name.replace(markdownExtension, ''), baseUrl: url.href, source: 'directory'
    }]
  }))
  return entries.flat()
}

export async function fetchStaticDocs(path, signal) {
  const base = new URL('.', document.baseURI)
  const segments = path.replaceAll('\\', '/').split('/').filter(Boolean)
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new Error('请输入站点内的相对目录，例如 mdData。')
  }
  const directory = new URL(segments.map(encodeURIComponent).join('/') + '/', base)
  const docs = await readDirectory(directory, signal)
  docs.sort((a, b) => a.folder.localeCompare(b.folder, 'zh-CN') || a.label.localeCompare(b.label, 'zh-CN'))
  return {
    dirPath: path,
    candidates: [{ label: '默认文档目录', path: 'mdData', count: path === 'mdData' ? docs.length : undefined }],
    docs
  }
}
