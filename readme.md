# ReadMD Studio

原生 JavaScript/TypeScript Markdown 阅读器。支持文档与文件夹导入、拖放、服务端目录读取、折叠大纲、跨文档检索、文内高亮、亮暗主题、Mermaid 图表交互及 PNG、PDF、Word 导出。Word 导出为可用 Word 打开的 .doc 文件。

## 运行 demo

需要 Node.js 20.19+（20.x）或 22.12+。

    npm ci
    npm run dev

在 http://localhost:8899 打开。开发命令先打包 lib，demo 直接从 dist-lib 引用 ESM 和 CSS。修改 lib 源码后，重新执行 npm run build:lib 并刷新 demo。

    npm run build
    npm run preview

构建后的 demo 在 dist/，可直接部署到静态网站或子目录。默认加载 public/mdData 中的 Markdown。

切到「文档列表」可以输入目录、从快捷目录切换，或通过页面工具栏导入本地文件或文件夹。从 localhost 打开开发或预览页面时，可以直接输入本机目录。局域网访问时，使用 MD_DOCS_DIR 注册项目外的目录，多个目录以分号分隔。在 Windows PowerShell 中可按下面的方式设置。

    $env:MD_DOCS_DIR = 'D:\docs;D:\notes'
    npm run dev

纯静态部署读取构建时生成的目录清单。构建前设置 MD_DOCS_DIR 可把指定目录的 Markdown 收录进 demo，记得只选择适合公开部署的文档。放在 public/ 下的资源可随 demo 一起部署。

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
