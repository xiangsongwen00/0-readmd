import { marked } from 'marked'
import DOMPurify from 'dompurify'

async function copyCode(code: HTMLElement, button: HTMLButtonElement) {
  const text = code.textContent || ''
  let copied = false
  try {
    await navigator.clipboard.writeText(text)
    copied = true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.cssText = 'position:fixed;opacity:0'
    document.body.append(textarea)
    try {
      textarea.select()
      copied = document.execCommand('copy')
    } catch {
      copied = false
    } finally {
      textarea.remove()
      button.focus()
    }
  }
  button.textContent = copied ? '已复制' : '复制失败'
  setTimeout(() => { button.textContent = '复制' }, 1200)
}

export function renderContent(container: HTMLElement, markdown: string, baseUrl?: string) {
  const html = marked.parse(markdown, { async: false, gfm: true })
  container.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })

  if (baseUrl) {
    const base = new URL(baseUrl, document.baseURI)
    for (const el of container.querySelectorAll('img[src], video[src], source[src], a[href]')) {
      const name = el.matches('a') ? 'href' : 'src'
      const value = el.getAttribute(name)
      if (!value || value.startsWith('#')) continue
      try {
        el.setAttribute(name, new URL(value, base).href)
      } catch {
        // Keep the original attribute when the URL cannot be resolved.
      }
    }
  }

  for (const image of container.querySelectorAll('img')) {
    if (!/\.(mp4|webm|ogg)(?:[?#]|$)/i.test(image.getAttribute('src') || '')) continue
    const video = document.createElement('video')
    video.controls = true
    video.src = image.src
    video.textContent = image.alt
    image.replaceWith(video)
  }

  for (const code of container.querySelectorAll<HTMLElement>('pre > code')) {
    const pre = code.parentElement
    if (code.classList.contains('language-mermaid')) {
      const diagram = document.createElement('div')
      diagram.className = 'mermaid'
      diagram.textContent = code.textContent
      pre.replaceWith(diagram)
      continue
    }
    const button = document.createElement('button')
    button.className = 'code-copy-btn'
    button.type = 'button'
    button.textContent = '复制'
    button.addEventListener('click', () => void copyCode(code, button))
    pre.append(button)
  }

  for (const table of container.querySelectorAll('table')) {
    const wrapper = document.createElement('div')
    wrapper.className = 'md-table-wrap'
    table.before(wrapper)
    wrapper.append(table)
  }
}
