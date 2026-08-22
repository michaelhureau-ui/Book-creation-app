import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import '@/styles.css'

// Offline support. Registered after load so it never competes with the app's
// own first paint, and only in a built app — a stale worker in dev is a trap.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unavailable worker only costs offline use; the app still runs.
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
