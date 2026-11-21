import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { markdownCatalog } from './scripts/markdownCatalog.js'

export default defineConfig({
  base: './',
  plugins: [markdownCatalog()],
  server: { port: 8899 },
  preview: { port: 8899 },
  build: {
    rollupOptions: {
      input: [
        fileURLToPath(new URL('./index.html', import.meta.url)),
        fileURLToPath(new URL('./test/demo.html', import.meta.url))
      ]
    }
  }
})
