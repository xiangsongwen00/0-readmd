import { createMarkdownEngine } from '../dist-lib/read-markdown-engine.mjs'
import '../dist-lib/read-markdown-engine.css'
import { fetchStaticDocs } from './staticDocs.js'

const picker = document.createElement('div')
picker.className = 'readmd-directory'
picker.innerHTML = `
  <form>
    <input type="text" placeholder="指定服务端文档目录" aria-label="服务端文档目录" value="mdData">
    <button type="submit">读取</button>
  </form>
  <select aria-label="快捷目录" hidden></select>
  <small role="status"></small>`
const form = picker.querySelector('form')
const input = picker.querySelector('input')
const submit = picker.querySelector('button')
const shortcuts = picker.querySelector('select')
const status = picker.querySelector('small')
const app = document.querySelector('#app')
const engine = createMarkdownEngine({ container: app, directoryPicker: picker, windowEvents: true })

let request
async function fetchDirectory(path, signal) {
  if (import.meta.env.DEV) {
    const url = new URL('api/docs', document.baseURI)
    url.searchParams.set('dir', path === 'mdData' ? 'public/mdData' : path)
    const response = await fetch(url, { signal, headers: { 'X-ReadMD-Directory': '1' } })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '目录读取失败')
    return data
  }
  return fetchStaticDocs(path, signal)
}

async function showDirectory(path) {
  request?.abort()
  const pending = new AbortController()
  request = pending
  status.textContent = '正在读取目录…'
  submit.disabled = true
  try {
    const directory = await fetchDirectory(path || 'mdData', pending.signal)
    if (pending.signal.aborted) return
    const docs = directory.docs.map(doc => ({
      ...doc,
      baseUrl: doc.baseUrl ? new URL(doc.baseUrl, document.baseURI).href : undefined
    }))
    const preferred = docs.find(doc => doc.label === 'API文档')
    engine.setDocs(docs, preferred?.id || docs[0]?.id)
    input.value = directory.dirPath
    shortcuts.replaceChildren(new Option('快捷目录', ''), ...directory.candidates.map(item =>
      new Option(item.count === undefined ? item.label : item.label + ' (' + item.count + ')', item.path)))
    shortcuts.value = directory.dirPath
    shortcuts.hidden = directory.candidates.length === 0
    status.textContent = directory.dirPath
  } catch (error) {
    if (!pending.signal.aborted) status.textContent = error.message
  } finally {
    if (request === pending) submit.disabled = false
  }
}

form.addEventListener('submit', event => {
  event.preventDefault()
  void showDirectory(input.value.trim())
})
shortcuts.addEventListener('change', () => {
  if (shortcuts.value) void showDirectory(shortcuts.value)
})
app.addEventListener('readmd:local-docs', event => {
  request?.abort()
  status.textContent = event.detail
  submit.disabled = false
})
void showDirectory(input.value)
