import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Stamp the service worker with the build it came from.
 *
 * A browser installs a new worker only when the bytes of `sw.js` differ. The
 * file is handwritten and rarely edited, so without a stamp an app installed
 * to the home screen — which is resumed, not reloaded — can go on serving the
 * copy it was installed with for days, which looks exactly like a fix that did
 * not work. One changing line is enough for the browser to notice, take the
 * new worker, and let the app offer the reload.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    async closeBundle() {
      const file = path.resolve(__dirname, 'dist/sw.js')
      try {
        const source = await readFile(file, 'utf8')
        await writeFile(file, source.replace('__BUILD__', new Date().toISOString()))
      } catch {
        // No worker in this build; nothing to stamp.
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5180 },
})
