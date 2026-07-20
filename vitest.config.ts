import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts (which roots at src/renderer for the build) so
// tests are discovered from the project root.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
