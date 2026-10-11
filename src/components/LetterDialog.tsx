import { useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import { drawnPanels, letterBook, type LetterProgress } from '@/lib/story/letter'
import type { TrimId } from '@/lib/graphic/render'
import type { Book } from '@/types'

/**
 * Writing the words onto pictures that already exist.
 *
 * The companion to Fit words. Fit words moves lettering that was written
 * before the artwork; this writes the lettering from the artwork, by showing
 * each page to the model and asking what is said on it.
 */
export function LetterDialog(
  { book, trim, onClose }: { book: Book; trim: TrimId; onClose: () => void },
) {
  const setPanelBalloons = useStore((s) => s.setPanelBalloons)
  const [only, setOnly] = useState(true)
  const [progress, setProgress] = useState<LetterProgress | null>(null)
  const [done, setDone] = useState<{ written: number; stopped?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { drawn, wordless } = useMemo(() => {
    const panels = book.pages.flatMap((page) => drawnPanels(page))
    return {
      drawn: panels.length,
      wordless: panels.filter(({ panel }) => panel.balloons.length === 0).length,
    }
  }, [book])

  const busy = progress !== null
  const todo = only ? wordless : drawn
  const picture = book.writing?.form === 'picture'

  const run = async (): Promise<void> => {
    if (busy || todo === 0) return
    setError(null)
    setDone(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await letterBook(
        book,
        { kind: picture ? 'picture' : 'graphic', trim, skipLettered: only },
        {
          onProgress: setProgress,
          apply: (pageId, panelId, balloons, band) =>
            setPanelBalloons(book.id, pageId, panelId, balloons, band),
        },
        controller.signal,
      )
      setDone(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The words could not be written.')
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  return (
    <Modal
      title="Write the words from the pictures"
      subtitle={`${wordless} of ${drawn} drawn panels have no words on them yet.`}
      onClose={() => { abortRef.current?.abort(); onClose() }}
      footer={(
        <>
          <button
            className="btn btn-outline"
            onClick={() => (busy ? abortRef.current?.abort() : onClose())}
          >
            {busy ? 'Stop' : 'Close'}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || todo === 0}
            onClick={() => void run()}
          >
            {busy ? 'Writing…' : todo === 0 ? 'Nothing to write' : `Write the words for ${todo}`}
          </button>
        </>
      )}
    >
      <div className="space-y-3 text-sm text-ink-soft">
        <p>
          Each page is shown to the writer as it was drawn, along with the note the picture was
          drawn from, and the words come back written for that picture — with every balloon above
          the artwork and its tail on whoever is speaking.
        </p>

        <div className="space-y-2">
          {([
            [true, 'Only the panels with no words yet', 'Leaves everything already written alone.'],
            [false, 'Every drawn panel', 'Replaces the words on panels that have some. Anything you placed by hand is kept.'],
          ] as const).map(([value, label, note]) => (
            <label
              key={String(value)}
              className={`block cursor-pointer rounded-lg border p-2 ${
                only === value ? 'border-accent bg-accent-soft/40' : 'border-rule'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="radio"
                  className="accent-accent"
                  checked={only === value}
                  disabled={busy}
                  onChange={() => setOnly(value)}
                />
                {label}
              </span>
              <span className="mt-0.5 block pl-6 text-xs text-ink-faint">{note}</span>
            </label>
          ))}
        </div>

        <p className="text-xs text-ink-faint">
          One go at the writing per page, so a long book takes a few minutes and costs a little.
          Every page is saved as it is written: stopping early keeps what is done.
        </p>

        {drawn === 0 && (
          <p className="rounded-md border border-rule bg-paper-sunk/60 p-2 text-xs">
            Nothing is drawn yet, so there are no pictures to write from. Press Draw first.
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
            <p className="mt-2 text-xs">{progress.label}</p>
            <p className="text-xs text-ink-faint">{progress.written} balloons written.</p>
          </div>
        )}

        {done && !busy && (
          <div className="space-y-1 text-xs">
            <p>
              {done.written === 0
                ? 'Nothing was written — the service had no words for these pictures.'
                : `${done.written} balloons written from the artwork.`}
            </p>
            {done.stopped && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                It stopped early: {done.stopped} What was written is saved — run it again to carry on.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>
        )}
      </div>
    </Modal>
  )
}
