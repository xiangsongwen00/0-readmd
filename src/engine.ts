import { renderContent } from './content.js'
import { droppedFiles, pickedFiles, readLocalDocs } from './localFiles.js'
import { buildFolderTree, filterTocTree, syncTocFromDom } from './utils/toc.js'
import { applySearchHighlights, countKeywordMatches, setActiveSearchHit } from './utils/searchHighlight.js'
import { renderMermaidDiagrams } from './utils/mermaidRenderer.js'
import { cleanupMermaidZoom, initMermaidZoom } from './utils/mermaidZoom.js'
import type { FolderTreeNode, MarkdownDoc, TocItem } from './types/docs.js'

export type MarkdownInput = Partial<MarkdownDoc> & Pick<MarkdownDoc, 'content'>
export interface MarkdownEngineOptions {
  container?: string | HTMLElement
  docs?: MarkdownInput[]
  defaultDocId?: string
  directoryPicker?: HTMLElement
  windowEvents?: boolean
}

export interface MarkdownEngine {
  render(): void
  setDocs(docs: MarkdownInput[], defaultDocId?: string): void
  renderDocById(id: string): boolean
  getDocs(): MarkdownDoc[]
  getCurrentDoc(): MarkdownDoc | null
  destroy(): void
}

const labelFor = (path: string) => path.split(/[\\/]/).pop().replace(/\.(md|markdown)$/i, '')

export function createMarkdownDocsFromModules(modules: Record<string, unknown>) {
  return Object.entries(modules).flatMap(([path, module]) => {
    const content = typeof module === 'string' ? module : (module as { default?: unknown })?.default
    return typeof content === 'string' && content ? [{ path, label: labelFor(path), content }] : []
  }).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN', { numeric: true }))
}

function normalizeDocs(docs: MarkdownInput[]): MarkdownDoc[] {
  if (!Array.isArray(docs)) return []
  return docs.flatMap((doc, index) => {
    if (typeof doc?.content !== 'string') return []
    const path = String(doc.path || doc.id || 'doc-' + (index + 1))
    const relative = path.replaceAll('\\', '/')
    return [{ ...doc, path, label: String(doc.label || labelFor(path)),
      folder: doc.folder ?? relative.slice(0, Math.max(0, relative.lastIndexOf('/'))).replace(/^\/+/, '') }]
  })
}

function button(text: string, click: () => void) {
  const el = document.createElement('button')
  el.type = 'button'
  el.textContent = text
  el.addEventListener('click', click)
  return el
}

function treeGroup(label: string | HTMLElement, children: HTMLElement, open: boolean) {
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  summary.append(label)
  details.open = open
  details.append(summary, children)
  return details
}

function treeList(nodes: HTMLElement[]) {
  const list = document.createElement('ul')
  for (const node of nodes) {
    const item = document.createElement('li')
    item.append(node)
    list.append(item)
  }
  return list
}

function formatSize(size?: number) {
  if (size === undefined) return ''
  return size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB'
}

const instances = new WeakMap<HTMLElement, () => void>()

export function createMarkdownEngine(options: MarkdownEngineOptions = {}): MarkdownEngine {
  const { container = '#app', directoryPicker } = options
  const host = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container
  if (!host) throw new Error('Markdown 引擎初始化失败，未找到容器: ' + container)
  instances.get(host)?.()

  const reader = document.createElement('div')
  reader.className = 'readmd'
  reader.tabIndex = -1
  reader.innerHTML = `
    <aside class="reader-sidebar-bg" aria-label="文档导航">
      <strong class="readmd-brand">ReadMD Studio</strong>
      <div class="readmd-tabs">
        <button type="button" data-outline>大纲目录</button>
        <button type="button" data-docs>文档列表</button>
      </div>
      <div class="readmd-filter">
        <input type="search" data-filter aria-label="过滤大纲标题">
        <button type="button" data-expand>折叠</button>
      </div>
      <div class="readmd-navigation custom-scrollbar"></div>
      <small data-nav-summary></small>
      <div class="readmd-resizer" role="separator" tabindex="0" aria-label="调整侧栏宽度" aria-orientation="vertical"></div>
    </aside>
    <main class="reader-canvas-bg">
      <header class="reader-header-bg">
        <button type="button" data-sidebar aria-label="切换侧栏" aria-expanded="true">☰</button>
        <div class="readmd-doc-switch">
          <button type="button" data-doc-prev aria-label="上一篇文档">↑</button>
          <select data-doc-select aria-label="切换当前 Markdown 文档"></select>
          <button type="button" data-doc-next aria-label="下一篇文档">↓</button>
        </div>
        <div class="readmd-tools">
          <button type="button" data-action="import-docs">导入文档</button>
          <button type="button" data-folder>导入文件夹</button>
          <button type="button" data-theme aria-pressed="false">深色模式</button>
          <button type="button" data-export="pdf">导出 PDF</button>
          <button type="button" data-export="word">导出 Word</button>
        </div>
        <div class="readmd-search">
          <input type="search" data-search placeholder="搜索文内关键词 (Ctrl+F)" aria-label="搜索文内关键词">
          <label><input type="checkbox"> 区分大小写</label>
          <span data-count aria-live="polite"></span>
          <button type="button" data-prev aria-label="上一个结果">↑</button>
          <button type="button" data-next aria-label="下一个结果">↓</button>
          <button type="button" data-clear aria-label="清除搜索" hidden>清除</button>
        </div>
      </header>
      <progress max="100" value="0" aria-label="阅读进度"></progress>
      <div class="readmd-scroll custom-scrollbar">
        <article class="reader-sheet-bg">
          <div class="readmd-breadcrumb" hidden></div>
          <div class="md-prose"></div>
        </article>
      </div>
      <button type="button" data-top hidden>返回顶部</button>
    </main>
    <input hidden type="file" multiple accept=".md,.markdown,text/markdown">
    <input hidden type="file" multiple webkitdirectory data-folder-input>
    <div class="readmd-drop" hidden>松开以导入 Markdown 文件或文件夹</div>
    <output class="readmd-status" role="status" hidden></output>`
  host.replaceChildren(reader)
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => reader.querySelector<T>(selector)
  const sidebar = find('aside')
  const navigation = find('.readmd-navigation')
  const content = find('.md-prose')
  const breadcrumb = find('.readmd-breadcrumb')
  const scroll = find('.readmd-scroll')
  const progress = find<HTMLProgressElement>('progress')
  const search = find<HTMLInputElement>('[data-search]')
  const filter = find<HTMLInputElement>('[data-filter]')
  const expand = find<HTMLButtonElement>('[data-expand]')
  const docSelect = find<HTMLSelectElement>('[data-doc-select]')
  const previousDoc = find<HTMLButtonElement>('[data-doc-prev]')
  const nextDoc = find<HTMLButtonElement>('[data-doc-next]')
  const caseSensitive = find<HTMLInputElement>('input[type=checkbox]')
  const outlineTab = find('[data-outline]')
  const docsTab = find('[data-docs]')
  const top = find('[data-top]')
  const status = find('output')
  const drop = find('.readmd-drop')
  const exporters = reader.querySelectorAll<HTMLButtonElement>('[data-export]')
  if (directoryPicker) sidebar.insertBefore(directoryPicker, find('.readmd-filter'))
  const windowListeners = new AbortController()
  const listenerTarget = options.windowEvents ? window : reader

  let docs: MarkdownDoc[] = []
  let currentDoc: MarkdownDoc | null = null
  let toc: TocItem[] = []
  let headings: HTMLElement[] = []
  let activeHeading: string
  let tab: 'outline' | 'docs' = 'outline'
  const filters = { outline: '', docs: '' }
  const closedHeadings = new Set<string>()
  const closedFolders = new Set<string>()
  let hits: HTMLElement[] = []
  let activeHit = 0
  let revision = 0
  let importRevision = 0
  let destroyed = false
  let exporting = false
  let diagramsReady: Promise<void> = Promise.resolve()
  let statusTimer: ReturnType<typeof setTimeout>
  let dragDepth = 0

  function notify(message: string) {
    clearTimeout(statusTimer)
    status.textContent = message
    status.hidden = false
    statusTimer = setTimeout(() => { status.hidden = true }, 4000)
  }

  function scrollTo(target: HTMLElement) {
    scroll.scrollTo({
      top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16,
      behavior: 'smooth'
    })
  }

  function outlineNodes(items: TocItem[]): HTMLUListElement {
    return treeList(items.map(item => {
      const link = button(item.text, () => {
        scrollTo(headings.find(heading => heading.id === item.id))
        activeHeading = item.id
        markActiveHeading()
        closeMobileSidebar()
      })
      link.dataset.heading = item.id
      if (!item.children.length) return link
      const group = treeGroup(link, outlineNodes(item.children), Boolean(filters.outline) || !closedHeadings.has(item.id))
      group.dataset.headingGroup = item.id
      link.addEventListener('click', event => event.preventDefault())
      group.addEventListener('toggle', () => {
        if (!group.isConnected || filters.outline) return
        if (group.open) closedHeadings.delete(item.id)
        else closedHeadings.add(item.id)
        updateExpandLabel()
      })
      return group
    }))
  }

  function folderNodes(node: FolderTreeNode, counts: Map<MarkdownDoc, number>): HTMLUListElement {
    const folders = node.folders.map(folder => {
      const group = treeGroup(folder.name, folderNodes(folder, counts), Boolean(filters.docs) || !closedFolders.has(folder.fullPath))
      group.addEventListener('toggle', () => {
        if (!group.isConnected || filters.docs) return
        if (group.open) closedFolders.delete(folder.fullPath)
        else closedFolders.add(folder.fullPath)
      })
      return group
    })
    const links = node.docs.map(doc => {
      const count = counts.get(doc)
      const suffix = count !== undefined ? count + ' 处' : formatSize(doc.size)
      const link = button(doc.label, () => {
        if (filters.docs) search.value = filters.docs
        selectDoc(doc)
        closeMobileSidebar()
      })
      if (suffix) {
        const metadata = document.createElement('small')
        metadata.textContent = suffix
        link.append(metadata)
      }
      link.title = doc.path
      if (doc === currentDoc) link.setAttribute('aria-current', 'true')
      return link
    })
    return treeList([...folders, ...links])
  }

  function markActiveHeading() {
    if (tab !== 'outline' || !activeHeading) return
    navigation.querySelector('[aria-current]')?.removeAttribute('aria-current')
    const link = navigation.querySelector('[data-heading="' + CSS.escape(activeHeading) + '"]')
    link?.setAttribute('aria-current', 'location')
    let group = link?.closest('details')
    if (group?.dataset.headingGroup === activeHeading) group = group.parentElement?.closest('details')
    while (group) {
      group.open = true
      closedHeadings.delete(group.dataset.headingGroup)
      group = group.parentElement?.closest('details')
    }
  }

  function updateExpandLabel() {
    const groups = Array.from(navigation.querySelectorAll<HTMLDetailsElement>('details[data-heading-group]'))
    expand.textContent = groups.some(group => !group.open) ? '展开' : '折叠'
    expand.disabled = !groups.length
  }

  function updateNavigation() {
    outlineTab.setAttribute('aria-pressed', String(tab === 'outline'))
    docsTab.setAttribute('aria-pressed', String(tab === 'docs'))
    const keyword = filters[tab]
    if (tab === 'docs') {
      const query = keyword.toLowerCase()
      const counts = new Map<MarkdownDoc, number>()
      const matching = keyword ? docs.filter(doc => {
        const count = countKeywordMatches(doc.content, keyword)
        const matches = count || doc.path.toLowerCase().includes(query) || doc.label.toLowerCase().includes(query)
        if (matches) counts.set(doc, count)
        return matches
      }) : docs
      navigation.replaceChildren(matching.length ? folderNodes(buildFolderTree(matching), counts) : '没有匹配的文档')
      find('[data-nav-summary]').textContent = (keyword ? matching.length + ' / ' : '') + docs.length + ' 篇'
    } else {
      const matching = filterTocTree(toc, keyword)
      navigation.replaceChildren(matching.length ? outlineNodes(matching) : '没有匹配的标题')
      const active = navigation.querySelector('[data-heading="' + CSS.escape(activeHeading || '') + '"]')
      active?.setAttribute('aria-current', 'location')
      updateExpandLabel()
      find('[data-nav-summary]').textContent = headings.length + ' 个标题'
    }
  }

  function updatePosition() {
    const max = scroll.scrollHeight - scroll.clientHeight
    progress.value = max > 0 ? 100 * scroll.scrollTop / max : 0
    top.hidden = scroll.scrollTop < 360
    const threshold = scroll.getBoundingClientRect().top + 70
    let next = headings[0]?.id
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > threshold) break
      next = heading.id
    }
    if (next !== activeHeading) {
      activeHeading = next
      markActiveHeading()
    }
  }

  function showMatch(offset: number) {
    if (hits.length) {
      activeHit = (activeHit + offset + hits.length) % hits.length
      setActiveSearchHit(hits, activeHit, scroll)
    }
    find('[data-count]').textContent = search.value.trim() ? (hits.length ? (activeHit + 1) + ' / ' + hits.length : '0 / 0') : ''
    find('[data-clear]').hidden = !search.value
    for (const el of reader.querySelectorAll<HTMLButtonElement>('[data-prev], [data-next]')) el.disabled = !hits.length
  }

  function updateSearch() {
    hits = applySearchHighlights(content, search.value, caseSensitive.checked)
    activeHit = 0
    showMatch(0)
  }

  function updateExportButtons() {
    exporters.forEach(el => { el.disabled = !currentDoc || exporting || destroyed })
  }

  function render() {
    if (destroyed) return
    const token = ++revision
    cleanupMermaidZoom(content)
    const index = docs.indexOf(currentDoc)
    docSelect.replaceChildren(...(docs.length
      ? docs.map((doc, i) => new Option(doc.label, String(i)))
      : [new Option('暂无可用文档', '')]))
    docSelect.disabled = !docs.length
    docSelect.selectedIndex = index < 0 ? 0 : index
    previousDoc.disabled = index <= 0
    nextDoc.disabled = index < 0 || index >= docs.length - 1
    breadcrumb.hidden = !currentDoc
    if (currentDoc) breadcrumb.textContent = [currentDoc.folder || '根目录',
      currentDoc.relativePath || currentDoc.path, formatSize(currentDoc.size)].filter(Boolean).join(' · ')
    if (currentDoc) renderContent(content, currentDoc.content, currentDoc.baseUrl)
    else content.textContent = '请选择或导入 Markdown 文档。'
    toc = syncTocFromDom(content).items
    closedHeadings.clear()
    headings = Array.from(content.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    activeHeading = undefined
    scroll.scrollTop = 0
    updateNavigation()
    updatePosition()
    updateSearch()
    updateExportButtons()
    diagramsReady = renderMermaidDiagrams(content, () => token !== revision)
      .then(() => {
        if (token !== revision) return
        initMermaidZoom(content)
        updatePosition()
      }).catch(() => {
        if (token === revision) notify('图表加载失败')
      })
  }

  function selectDoc(doc: MarkdownDoc) {
    currentDoc = doc
    render()
  }

  function stepDocument(offset: number) {
    const next = docs[docs.indexOf(currentDoc) + offset]
    if (next) selectDoc(next)
  }

  function lookup(id: string) {
    return docs.find(doc => doc.path === id || doc.id === id)
  }

  function setDocs(nextDocs: MarkdownInput[], defaultDocId = '') {
    if (destroyed) return
    importRevision++
    closedFolders.clear()
    docs = normalizeDocs(nextDocs)
    currentDoc = lookup(defaultDocId) || docs.find(doc => doc.path.includes('影像处理总结.md'))
      || docs.find(doc => doc.path.includes('projecthandover.md')) || docs[0] || null
    render()
  }

  async function importFiles(files: ReturnType<typeof droppedFiles> | ReturnType<typeof pickedFiles>, source: string) {
    const token = ++importRevision
    try {
      const imported = await readLocalDocs(await files)
      if (token !== importRevision || destroyed) return
      if (!imported.length) return notify('没有找到 Markdown 文件')
      setDocs(imported, imported[0].id)
      reader.dispatchEvent(new CustomEvent('readmd:local-docs', { bubbles: true, detail: source }))
      notify('已加载 ' + imported.length + ' 篇 Markdown 文档')
    } catch {
      if (token === importRevision && !destroyed) notify('无法读取本地文件')
    }
  }

  const fileInput = find<HTMLInputElement>('input[type=file]')
  const folderInput = find<HTMLInputElement>('[data-folder-input]')
  find('[data-action=import-docs]').addEventListener('click', event => {
    if (!event.defaultPrevented) fileInput.click()
  })
  find('[data-folder]').addEventListener('click', () => folderInput.click())
  for (const input of [fileInput, folderInput]) {
    input.addEventListener('change', () => {
      const files = pickedFiles(input.files)
      input.value = ''
      if (files.length) void importFiles(files, input === folderInput
        ? '本地文件夹 (' + files[0].path.split('/')[0] + ')' : '本地导入文件')
    })
  }

  const listenerOptions = { signal: windowListeners.signal }
  listenerTarget.addEventListener('dragenter', (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return
    dragDepth++
    drop.hidden = false
  }, listenerOptions)
  listenerTarget.addEventListener('dragover', (event: DragEvent) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  }, listenerOptions)
  listenerTarget.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (!dragDepth) drop.hidden = true
  }, listenerOptions)
  listenerTarget.addEventListener('drop', (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    dragDepth = 0
    drop.hidden = true
    void importFiles(droppedFiles(event.dataTransfer), '拖入文档集')
  }, listenerOptions)

  const theme = find('[data-theme]')
  function setTheme(dark: boolean) {
    reader.classList.toggle('dark', dark)
    theme.setAttribute('aria-pressed', String(dark))
    theme.textContent = dark ? '浅色模式' : '深色模式'
  }
  try { setTheme(localStorage.getItem('readmd-theme') === 'dark') } catch { setTheme(false) }
  theme.addEventListener('click', () => {
    const dark = !reader.classList.contains('dark')
    setTheme(dark)
    try { localStorage.setItem('readmd-theme', dark ? 'dark' : 'light') } catch { /* Storage may be disabled. */ }
  })

  exporters.forEach(el => el.addEventListener('click', async () => {
    if (!currentDoc || exporting) return
    const token = revision
    const label = currentDoc.label
    const buttonLabel = el.textContent
    exporting = true
    el.textContent = '导出中…'
    updateExportButtons()
    try {
      await diagramsReady
      const { exportContentToPdf, exportContentToWord } = await import('./utils/exportDocs.js')
      if (token !== revision) return
      const exportDocument = el.dataset.export === 'pdf' ? exportContentToPdf : exportContentToWord
      await exportDocument(content, label)
      if (token === revision) notify('已导出 ' + label + (el.dataset.export === 'pdf' ? '.pdf' : '.doc'))
    } catch (error) {
      if (token === revision) notify(buttonLabel + '失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      exporting = false
      el.textContent = buttonLabel
      updateExportButtons()
    }
  }))

  const sidebarButton = find('[data-sidebar]')
  const narrow = matchMedia('(max-width: 650px)')
  function setSidebarOpen(open: boolean) {
    sidebar.hidden = !open
    sidebarButton.setAttribute('aria-expanded', String(open))
  }
  function closeMobileSidebar() {
    if (narrow.matches) setSidebarOpen(false)
  }
  setSidebarOpen(!narrow.matches)
  sidebarButton.addEventListener('click', () => setSidebarOpen(sidebar.hidden))
  function showTab(next: typeof tab) {
    tab = next
    const label = tab === 'outline' ? '过滤大纲标题' : '跨文档检索文件名或正文'
    filter.placeholder = label
    filter.setAttribute('aria-label', label)
    filter.value = filters[tab]
    expand.hidden = tab !== 'outline'
    if (directoryPicker) directoryPicker.hidden = tab !== 'docs'
    updateNavigation()
  }
  outlineTab.addEventListener('click', () => showTab('outline'))
  docsTab.addEventListener('click', () => showTab('docs'))
  filter.addEventListener('input', () => {
    filters[tab] = filter.value.trim()
    updateNavigation()
  })
  expand.addEventListener('click', () => {
    const groups = Array.from(navigation.querySelectorAll<HTMLDetailsElement>('details[data-heading-group]'))
    const open = groups.some(group => !group.open)
    for (const group of groups) {
      group.open = open
      if (open) closedHeadings.delete(group.dataset.headingGroup)
      else closedHeadings.add(group.dataset.headingGroup)
    }
    updateExpandLabel()
  })
  const resizer = find('.readmd-resizer')
  function resizeSidebar(width: number) {
    sidebar.style.width = Math.max(250, Math.min(460, width)) + 'px'
  }
  resizer.addEventListener('pointerdown', event => resizer.setPointerCapture(event.pointerId))
  resizer.addEventListener('pointermove', event => {
    if (resizer.hasPointerCapture(event.pointerId)) resizeSidebar(event.clientX - sidebar.getBoundingClientRect().left)
  })
  resizer.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    resizeSidebar(sidebar.offsetWidth + (event.key === 'ArrowLeft' ? -16 : 16))
  })
  search.addEventListener('input', updateSearch)
  caseSensitive.addEventListener('change', updateSearch)
  function clearSearch() {
    search.value = ''
    updateSearch()
    search.focus()
  }
  find('[data-clear]').addEventListener('click', clearSearch)
  find('[data-prev]').addEventListener('click', () => showMatch(-1))
  find('[data-next]').addEventListener('click', () => showMatch(1))
  docSelect.addEventListener('change', () => selectDoc(docs[Number(docSelect.value)]))
  previousDoc.addEventListener('click', () => stepDocument(-1))
  nextDoc.addEventListener('click', () => stepDocument(1))
  listenerTarget.addEventListener('keydown', (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      search.focus()
      search.select()
    } else if (event.target === search && event.key === 'Enter') {
      event.preventDefault()
      showMatch(event.shiftKey ? -1 : 1)
    } else if (event.target === search && event.key === 'Escape') {
      event.preventDefault()
      clearSearch()
    } else if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      stepDocument(event.key === 'ArrowUp' ? -1 : 1)
    }
  }, listenerOptions)
  content.addEventListener('click', event => {
    const href = (event.target as Element).closest('a')?.getAttribute('href')
    if (!href?.startsWith('#')) return
    const anchor = content.querySelector('#' + CSS.escape(href.slice(1)))
    if (anchor instanceof HTMLElement) {
      event.preventDefault()
      scrollTo(anchor)
    }
  })
  scroll.addEventListener('scroll', updatePosition, { passive: true })
  top.addEventListener('click', () => scroll.scrollTo({ top: 0, behavior: 'smooth' }))
  const observer = new ResizeObserver(updatePosition)
  observer.observe(content)
  observer.observe(scroll)

  function destroy() {
    if (destroyed) return
    destroyed = true
    revision++
    windowListeners.abort()
    clearTimeout(statusTimer)
    observer.disconnect()
    cleanupMermaidZoom(content)
    reader.remove()
    instances.delete(host)
    docs = []
    currentDoc = null
  }

  instances.set(host, destroy)
  showTab('outline')
  setDocs(options.docs ?? [], options.defaultDocId)
  return {
    render, setDocs,
    renderDocById(id: string) {
      const doc = lookup(id)
      if (!doc) return false
      selectDoc(doc)
      return true
    },
    getDocs: () => [...docs],
    getCurrentDoc: () => currentDoc,
    destroy
  }
}
