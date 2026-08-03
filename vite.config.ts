import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const r = (p: string) => resolve(import.meta.dirname, p)

// Bundles the renderer windows. Root is the renderer dir so the built HTML lands
// flat at dist/renderer/<name>.html (matching what the main process loads).
export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: {
    outDir: r('dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: r('src/renderer/dashboard.html'),
        overlay: r('src/renderer/overlay.html'),
        topbar: r('src/renderer/topbar.html'),
      },
    },
  },
  server: { port: 5173, fs: { allow: ['..', '../..'] } },
})
