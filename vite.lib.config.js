import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-lib',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'read-markdown-engine.mjs',
      cssFileName: 'read-markdown-engine'
    },
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  }
})
