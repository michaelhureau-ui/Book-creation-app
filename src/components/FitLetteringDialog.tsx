import { useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import { fitBookLettering, type FitProgress } from '@/lib/graphic/fit-book'
import type { FitMode } from '@/lib/graphic/fit'
import type { TrimId } from '@/lib/graphic/render'
import type { Book } from '@/types'

/**
 * Fitting the words to the pictures.
 *
 * The lettering is written before any picture exists, so it sits where an
 * empty panel suggested — which, once the artwork arrives underneath, is
 * regularly straight across somebody's face. This reads each panel for where
 * the detail is and moves the balloons onto the quiet parts, with their tails
 * on whoever is speaking.
 *
 * Only the positions change. The words, the order they are read in and who
 * says what are left exactly as they were.
 */
export function FitLetteringDialog(
  { book, trim, onClose }: { book: Book; trim: TrimId; onClose: () => void },
) {
  const setPanelBalloons = useStore((s) => s.setPanelBalloons)
  const [mode, setMode] = useState<FitMode>('band')
  const [progress, setProgress] = useState<FitProgress | null>(null)
  const [done, setDone] = useState<FitProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { drawn, lettered } = useMemo(() => {
    const panels = book.pages.flatMap((page) => page.panels)
    return {
      drawn: panels.filter((panel) => panel.assetId).length,
      lettered: panels.filter((panel) => panel.assetId && panel.balloons.length > 0).length,
    }
  }, [book])

  const busy = progress !== null

  const fit = async (): Promise<void> => {
    if (busy || lettered === 0) return
    setError(null)
    setDone(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await fitBookLettering(
        book, trim,
        (pageId, panelId, balloons, band) =>
          setPanelBalloons(book.id, pageId, panelId, balloons, band),
        setProgress, controller.signal, mode,
      )
      setDone(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The lettering could not be fitted.')
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  return (
    <Modal
      title="Fit the words to the pictures"
      subtitle={`${lettered} of ${drawn} drawn panels have lettering on them.`}
      onClose={() => { abortRef.current?.abort(); onClose() }}
      footer={(
        <>
          <button className="btn btn-outline" onClick={() => (busy ? abortRef.current?.abort() : onClose())}>
            {busy ? 'Stop' : 'Close'}
          </button>
          <button className="btn btn-primary" disabled={busy || lettered === 0} onClick={() => void fit()}>
            {busy ? 'Fitting…' : lettered === 0 ? 'Nothing to fit yet' : 'Fit the lettering'}
          </button>
        </>
      )}
    >
      <div className="space-y-3 text-sm text-ink-soft">
        <p>
          The words were written before the pictures were drawn, so they sit where an empty
          panel suggested — often straight across a face. This moves them.
        </p>

        <div className="space-y-2">
          {([
            ['band', 'Above the picture', 'The picture is drawn a little smaller and the words sit in a clear strip above it, with tails reaching down to whoever is speaking. Nothing is ever covered.'],
            ['over', 'On the picture', 'The words stay on the artwork, placed over the flattest parts the app can find. Keeps the picture full size, but on a busy drawing it can still land somewhere you would rather it did not.'],
          ] as const).map(([id, label, note]) => (
            <label
              key={id}
              className={`block cursor-pointer rounded-lg border p-2 ${
                mode === id ? 'border-accent bg-accent-soft/40' : 'border-rule'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="radio"
                  className="accent-accent"
                  checked={mode === id}
                  disabled={busy}
                  onChange={() => setMode(id)}
                />
                {label}
              </span>
              <span className="mt-0.5 block pl-6 text-xs text-ink-faint">{note}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-faint">
          Only the positions move. The words, the order they are read in and who says what stay
          exactly as they are — and any balloon you have dragged yourself is left alone.
        </p>

        {drawn === 0 && (
          <p className="rounded-md border border-rule bg-paper-sunk/60 p-2 text-xs">
            Nothing is drawn yet, so there is nothing to letter around. Press Draw first.
          </p>
        )}

        {progress && (
          <div className="rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.round((progress.page / Math.max(1, progress.pages)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs">Page {progress.page} of {progress.pages}.</p>
          </div>
        )}

        {done && !busy && (
          <p className="text-xs">
            {done.moved === 0
              ? 'Everything was already in a good spot.'
              : `${done.moved} balloons moved across ${done.pages} pages.`}
          </p>
        )}

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>
        )}
      </div>
    </Modal>
  )
}
