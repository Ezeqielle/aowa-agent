import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Overwolf loads window HTML from the packaged folder via relative paths, so the
// build must use a relative base and emit each window's HTML at a stable path.
// `public/` (manifest.json + icons) is copied to the dist root verbatim.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/background.html'),
        settings: resolve(__dirname, 'src/settings/settings.html'),
      },
    },
  },
})
