# ReadMD Studio

原生 JavaScript/TypeScript Markdown 阅读器。支持文档与文件夹导入、拖放、服务端目录读取、折叠大纲、跨文档检索、文内高亮、亮暗主题、Mermaid 图表交互及 PNG、PDF、Word 导出。Word 导出为可用 Word 打开的 .doc 文件。

## 运行 demo

需要 Node.js 20.19+（20.x）或 22.12+。

    npm ci
    npm run dev

在 http://localhost:8899 打开。开发命令先打包 lib，demo 直接从 dist-lib 引用 ESM 和 CSS。修改 lib 源码后，重新执行 npm run build:lib 并刷新 demo。

    npm run build

构建后的 demo 在 `dist/`。静态版运行时读取网页同级 `mdData/` 中的 Markdown。构建产物只有应用文件，文档目录由部署端维护。

将 `dist/` 中的应用文件部署到 `D:\0-myNet\readme`。将 Markdown 文件及其相对路径引用的资源放在该站点的 `mdData/` 中。静态服务器需要对该目录启用目录浏览，并能通过 HTTP 访问 Markdown 文件。在部署目录增删、改名或修改文件后，刷新网页，或在「文档列表」点击「读取」即可更新。

切到「文档列表」还可以输入站点内的相对目录，或通过工具栏导入本地文件和文件夹。使用 `npm run dev` 开发时，默认读取仓库的 `public/mdData/`，从 localhost 打开开发页面时也可以直接输入本机目录。局域网访问开发服务时，使用 `MD_DOCS_DIR` 注册项目外的目录，多个目录以分号分隔。在 Windows PowerShell 中可按下面的方式设置。

    $env:MD_DOCS_DIR = 'D:\docs;D:\notes'
    npm run dev

## 单独构建 lib

    npm run build:lib

dist-lib/read-markdown-engine.mjs 内含 Markdown、Mermaid 和导出依赖。样式在 dist-lib/read-markdown-engine.css，TypeScript 类型入口在 dist-lib/types/index.d.ts。

### 直接在浏览器中使用

使用 HTTP 服务打开下面的页面，HTML 与两个 lib 文件放在同一目录。

~~~html
<link rel="stylesheet" href="./read-markdown-engine.css">
<div id="app" style="height: 100vh"></div>
<script type="module">
  import { createMarkdownEngine } from './read-markdown-engine.mjs'

  createMarkdownEngine({
    container: '#app',
    docs: [{ path: 'demo.md', label: '示例文档', content: '# Hello\n\n你好，Markdown。' }],
    defaultDocId: 'demo.md'
  })
</script>
~~~

### 在其他项目中使用

在本仓库运行 npm run build:lib 和 npm pack，将生成的 .tgz 安装到使用方项目。

~~~js
import { createMarkdownEngine, createMarkdownDocsFromModules } from 'read-markdown-engine'
import 'read-markdown-engine/style.css'

const modules = import.meta.glob('./docs/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
})

const reader = createMarkdownEngine({
  container: '#app',
  docs: createMarkdownDocsFromModules(modules)
})
~~~

文档接收 content 和可选的 path、id、label、folder、baseUrl 等字段。baseUrl 用来解析文档内的相对链接和媒体地址。引擎实例支持 render()、setDocs(docs, defaultDocId?)、renderDocById(id)、getDocs()、getCurrentDoc() 和 destroy()。同一页面可创建多个实例。
