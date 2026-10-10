import { useEffect, useState } from 'react'

/**
 * Tells the reader when a newer Bookwright is waiting.
 *
 * Installed to the home screen, the app is resumed rather than reloaded, so it
 * can go on running the copy it was installed with for days — which looks
 * exactly like a fix that did not work. The service worker takes over as soon
 * as it is installed, so the moment it does, say so and offer the reload.
 *
 * Nothing is lost by reloading: every book lives in the browser's own storage,
 * not in the page.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let live = true

    const announce = (): void => { if (live) setReady(true) }

    // On a page that loaded without a worker, the first one to claim it is
    // this very build being installed, not a newer one — so that first claim
    // is passed over. Any claim after it is a genuinely new deploy.
    let installing = !navigator.serviceWorker.controller
    const claimed = (): void => {
      if (installing) { installing = false; return }
      announce()
    }
    navigator.serviceWorker.addEventListener('controllerchange', claimed)

    // Nothing checks for a new version on its own in an app that is never
    // navigated, so ask whenever it comes back to the front.
    const check = (): void => {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return
        void reg.update().catch(() => undefined)
        // A worker already waiting means the page is running the old files.
        if (reg.waiting && navigator.serviceWorker.controller) announce()
      })
    }
    const onShow = (): void => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onShow)
    const first = setTimeout(check, 2_000)

    return () => {
      live = false
      clearTimeout(first)
      navigator.serviceWorker.removeEventListener('controllerchange', claimed)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [])

  if (!ready) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-rule bg-paper px-3 py-2 shadow-lg">
        <span className="text-sm text-ink">A newer Bookwright is ready.</span>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button className="btn btn-ghost" onClick={() => setReady(false)}>
          Later
        </button>
      </div>
    </div>
  )
}
