import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const defaultDirectory = resolve(project, 'public/mdData')
const publicDirectory = resolve(project, 'public')
const ignored = new Set(['node_modules', 'build', 'dist', 'dist-lib', 'readMd', 'coverage'])
const forwardSlashes = path => path.split(sep).join('/')

function contains(root, directory) {
  const path = relative(root, directory)
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)
}

function displayPath(directory) {
  return contains(project, directory) ? forwardSlashes(relative(project, directory)) || '.' : directory
}

function isLocalReaderRequest(request) {
  const remote = request.socket.remoteAddress
  const host = request.headers.host?.toLowerCase()
  const origin = request.headers.origin
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
    && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host || '')
    && request.headers['x-readmd-directory'] === '1'
    && (!origin || origin === 'http://' + host || origin === 'https://' + host)
    && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin')
}

async function scan(root, directory = root) {
  const docs = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ignored.has(entry.name)) continue
    const file = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      docs.push(...await scan(root, file))
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      const path = forwardSlashes(relative(root, file))
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const [content, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      docs.push({
        id: 'dir:' + path, path, relativePath: path, folder,
        label: entry.name.replace(/\.(md|markdown)$/i, ''),
        content, size: info.size, updatedAt: info.mtime.toISOString(), source: 'directory',
        ...(contains(publicDirectory, file) && {
          baseUrl: forwardSlashes(relative(publicDirectory, file)).split('/').map(encodeURIComponent).join('/')
        })
      })
    }
  }
  return docs
}

async function sortedDocs(dir) {
  const docs = await scan(dir)
  return docs.sort((a, b) => a.folder.localeCompare(b.folder, 'zh-CN') || a.label.localeCompare(b.label, 'zh-CN'))
}

export function markdownCatalog() {
  const extraDirs = [...new Set((process.env.MD_DOCS_DIR || '').split(';').map(path => path.trim())
    .filter(Boolean).map(path => resolve(project, path)))].filter(dir => dir !== defaultDirectory)
  const roots = [
    { label: '默认文档目录', dir: defaultDirectory },
    ...extraDirs.map(dir => ({ label: basename(dir) || dir, dir }))
  ]
  const candidates = [...new Map([
    ...roots, { label: '项目根目录', dir: project }, { label: 'docs 目录', dir: resolve(project, 'docs') }
  ].map(item => [displayPath(item.dir), item])).values()]

  function middleware(server) {
    server.middlewares.use('/api/docs', async (request, response) => {
      const send = (status, data) => {
        response.statusCode = status
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(data))
      }

      try {
        const query = new URL(request.url, 'http://localhost').searchParams.get('dir')?.trim()
        const directory = resolve(project, query || defaultDirectory)
        const allowed = await Promise.all([project, ...extraDirs].map(dir => realpath(dir).catch(() => null)))
        const target = await realpath(directory).catch(() => null)
        if (!target || !(await stat(target)).isDirectory()) return send(404, { error: '目录不存在或不可访问' })
        const allowedTarget = allowed.some(root => root && contains(root, target)
          && !relative(root, target).split(sep).some(part => part.startsWith('.') || ignored.has(part)))
        if (!allowedTarget && !isLocalReaderRequest(request)) {
          return send(403, { error: '请选择项目中的目录，或通过 MD_DOCS_DIR 添加外部目录' })
        }

        const available = await Promise.all(candidates.map(async ({ label, dir }) => {
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
          if (!entries) return null
          return {
            label, path: displayPath(dir),
            count: entries.filter(entry => entry.isFile() && /\.(md|markdown)$/i.test(entry.name)).length
          }
        }))
        send(200, { dirPath: displayPath(directory), candidates: available.filter(Boolean), docs: await sortedDocs(target) })
      } catch (error) {
        server.config.logger.error(error.message)
        send(500, { error: '无法读取 Markdown 目录' })
      }
    })
  }

  return {
    name: 'readmd-catalog',
    configureServer: middleware
  }
}
