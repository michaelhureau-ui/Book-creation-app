/*
 * Offline support. Everything except image generation runs in the browser, so
 * once the app has been opened it should keep working with no connection.
 *
 * Two strategies, chosen by what can safely go stale:
 *   /assets/* — Vite fingerprints these filenames, so a cached copy is never
 *               wrong. Cache-first, kept forever.
 *   documents — network-first, so a new deploy is picked up as soon as the
 *               device is online, falling back to cache when it is not.
 * Anything else (notably /api/) is left alone entirely.
 */
const CACHE = 'bookwright-v1'

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest']).catch(() => undefined)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Generation must always hit the network; a cached answer would be nonsense.
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })),
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put('/', copy))
          }
          return response
        })
        // Offline: serve the last good copy of the app shell.
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    )
  }
})
