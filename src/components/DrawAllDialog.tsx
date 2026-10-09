import { useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import { drawPanels, NOT_CONFIGURED_HELP, QUOTA_HELP, type DrawingProgress } from '@/lib/story/generate'
import { STYLES, type ArtStyle } from '@/lib/graphic/image-prompt'
import type { Book } from '@/types'

/**
 * Drawing the pictures for a book that already exists.
 *
 * A written graphic novel is lettering over empty panels until somebody draws
 * them, and until now the only chance to do that was a tick-box at the moment
 * the book was first written. A book carried on, or one whose drawing stopped
 * half way, had no way back to it.
 *
 * Panels that already have artwork are left alone, so this can be stopped and
 * started as often as you like — it only ever fills in what is still empty.
 */
export function DrawAllDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const setPanelArt = useStore((s) => s.setPanelArt)
  const [style, setStyle] = useState<ArtStyle>('storybook')
  const [progress, setProgress] = useState<DrawingProgress | null>(null)
  const [done, setDone] = useState<DrawingProgress | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { empty, drawn, total } = useMemo(() => {
    const panels = book.pages.flatMap((page) => page.panels)
    const withArt = panels.filter((panel) => panel.assetId).length
    const waiting = panels.filter((p) => !p.assetId && (p.note ?? '').trim()).length
    return { empty: waiting, drawn: withArt, total: panels.length }
  }, [book])

  const busy = progress !== null

  const draw = async (): Promise<void> => {
    if (busy || empty === 0) return
    setError(null)
    setDone(null)
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ drawn: 0, total: empty })
    try {
      const result = await drawPanels(
        book, style,
        (pageId, panelId, assetId) => setPanelArt(book.id, pageId, panelId, assetId),
        setProgress, controller.signal,
      )
      setDone(result)
      if (result.stopped) setError({ code: 'drawing_stopped', message: result.stopped })
    } catch (err) {
      setError({
        code: 'provider_error',
        message: err instanceof Error ? err.message : 'The pictures could not be drawn.',
      })
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  return (
    <Modal
      title="Draw the pictures"
      subtitle={`${drawn} of ${total} panels in “${book.title || 'this book'}” have artwork.`}
      onClose={() => { abortRef.current?.abort(); onClose() }}
      footer={(
        <>
          <button
            className="btn btn-outline"
            onClick={() => (busy ? abortRef.current?.abort() : onClose())}
          >
            {busy ? 'Stop' : 'Close'}
          </button>
          <button className="btn btn-primary" disabled={busy || empty === 0} onClick={() => void draw()}>
            {busy ? 'Drawing…' : empty === 0 ? 'Every panel is drawn' : `Draw the ${empty} empty panels`}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="label">What should they look like?</span>
          <select
            className="field w-full"
            value={style}
            disabled={busy}
            aria-label="Art style"
            onChange={(e) => setStyle(e.target.value as ArtStyle)}
          >
            {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <span className="mt-1 block text-xs text-ink-faint">
            Every empty panel is drawn from the note the story left on it, in this style.
            Panels you have already drawn are left exactly as they are.
          </span>
        </label>

        {progress && (
          <div className="rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.round((progress.drawn / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {progress.drawn} of {progress.total} drawn. One at a time, so the book fills in as it goes.
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              Each picture is kept the moment it arrives — stopping keeps everything drawn so far.
            </p>
          </div>
        )}

        {done && !done.stopped && !busy && (
          <p className="text-xs text-ink-soft">
            {done.drawn} {done.drawn === 1 ? 'picture' : 'pictures'} drawn.
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">{error.message}</p>
            {error.code === 'not_configured' && <p className="mt-1">{NOT_CONFIGURED_HELP}</p>}
            {error.code === 'quota' && <p className="mt-1">{QUOTA_HELP}</p>}
            {error.code === 'drawing_stopped' && (
              <p className="mt-1">
                Everything drawn so far is kept. Press the button again whenever you like and it
                carries on from the next empty panel.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
