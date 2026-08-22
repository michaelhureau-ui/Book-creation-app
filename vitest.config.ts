import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    // parseBlocks runs on DOMParser, so the pure logic still needs a DOM.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
