import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import {
  checkStoryService, continueStory, NOT_CONFIGURED_HELP, QUOTA_HELP, STALE_BUILD_HELP, StoryFailed,
  type ServiceCheck, type StoryProgress,
} from '@/lib/story/generate'
import { chaptersIn, pagesIn } from '@/lib/story/limits'
import type { Book } from '@/types'
import type { StoryLength } from '@/lib/story/story'

const LENGTHS: { id: StoryLength; label: string }[] = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
]

/**
 * Carrying a half-written book on.
 *
 * A book that stopped at chapter eight of twenty-four is not a book to throw
 * away and write again — it is eight chapters and a plan. This asks only for
 * what is missing: how long it was meant to be, and what it is about if nobody
 * wrote that down at the time.
 */
export function ContinueDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const addStoryChapter = useStore((s) => s.addStoryChapter)
  const plan = book.writing

  const [length, setLength] = useState<StoryLength>(plan?.length ?? 'medium')
  const [idea, setIdea] = useState(plan?.idea ?? book.description.trim())
  const [progress, setProgress] = useState<StoryProgress | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [check, setCheck] = useState<ServiceCheck | 'running' | { failed: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [added, setAdded] = useState(0)

  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = progress !== null
  const done = book.chapters.length
  const wanted = Math.max(chaptersIn(book.kind, length), done)
  const left = wanted - done
  // The chapters already written say what the book is about better than any
  // sentence could, so nothing has to be typed to carry one on.
  const ready = done > 0 || idea.trim().length > 0 || Boolean(plan?.show)

  const carryOn = async (): Promise<void> => {
    if (busy || !ready) return
    setError(null)
    setProgress({ done, total: wanted, label: 'Picking up where it stopped…' })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await continueStory(book, {
        onProgress: setProgress,
        onStart: async () => book.id,
        onChapter: (id, chapter, pages) => addStoryChapter(id, chapter, pages),
      }, controller.signal, { idea, length })
      setAdded(result.chapters)
      setProgress(null)
      onClose()
    } catch (err) {
      if (controller.signal.aborted) { onClose(); return }
      if (err instanceof StoryFailed) setError({ code: err.code, message: err.message })
      else setError({ code: 'provider_error', message: 'The rest of the book could not be written.' })
      setProgress(null)
    } finally {
      abortRef.current = null
    }
  }

  return (
    <Modal
      title="Carry on writing"
      subtitle={`“${book.title || 'Untitled book'}” stops at chapter ${done}. This writes the rest.`}
      onClose={busy ? () => abortRef.current?.abort() : onClose}
      footer={(
        <>
          <button className="btn btn-outline" onClick={() => (busy ? abortRef.current?.abort() : onClose())}>
            {busy ? 'Stop' : 'Cancel'}
          </button>
          <button className="btn btn-primary" disabled={busy || !ready || left <= 0} onClick={() => void carryOn()}>
            {busy ? 'Writing…' : `Write the last ${left} ${left === 1 ? 'chapter' : 'chapters'}`}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {!plan && (
          <label className="block">
            <span className="label">What is this story about?</span>
            <textarea
              className="field h-20 w-full resize-none"
              value={idea}
              disabled={busy}
              maxLength={1200}
              placeholder={book.description || book.title}
              onChange={(e) => setIdea(e.target.value)}
              aria-label="What is this story about"
            />
            <span className="mt-1 block text-xs text-ink-faint">
              Optional. What is already written is read back and carried on from, so this
              only helps if there is something the chapters do not already say.
            </span>
          </label>
        )}

        <div>
          <span className="label">How long should it be?</span>
          <div className="grid grid-cols-3 gap-1">
            {LENGTHS.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                aria-pressed={length === option.id}
                className={clsx(
                  'rounded-md border px-1 py-1.5 text-xs leading-tight transition-colors disabled:opacity-50',
                  length === option.id
                    ? 'border-accent bg-accent-soft/60 font-semibold text-accent-deep'
                    : 'border-rule text-ink-soft hover:bg-paper-sunk',
                )}
                onClick={() => setLength(option.id)}
              >
                {option.label}
                <span className="mt-0.5 block text-[0.65rem] font-normal opacity-80">
                  {pagesIn(book.kind, option.id)} pages
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            {left > 0
              ? `${done} of ${wanted} chapters are written. ${left} to go.`
              : 'This book is already that long. Pick a longer one to carry on.'}
          </p>
        </div>

        {progress && (
          <div className="rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-soft">{progress.label}</p>
            <p className="mt-1 text-xs text-ink-faint">
              Each chapter is kept as it is written, so you can stop and keep them.
            </p>
          </div>
        )}

        {added > 0 && !busy && (
          <p className="text-xs text-ink-soft">{added} more chapters written.</p>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">{error.message}</p>
            {error.code === 'not_configured' && <p className="mt-1">{NOT_CONFIGURED_HELP}</p>}
            {error.code === 'quota' && <p className="mt-1">{QUOTA_HELP}</p>}
            {error.code === 'stale_build' && <p className="mt-1">{STALE_BUILD_HELP}</p>}
            <div className="mt-2 border-t border-red-200 pt-2">
              <button
                type="button"
                className="font-semibold underline disabled:opacity-60"
                disabled={check === 'running'}
                onClick={() => {
                  setCheck('running')
                  checkStoryService()
                    .then(setCheck)
                    .catch((err: unknown) =>
                      setCheck({ failed: err instanceof Error ? err.message : 'The check failed.' }))
                }}
              >
                {check === 'running' ? 'Asking Google…' : 'Check what Google says'}
              </button>
              {check && check !== 'running' && (
                'failed' in check
                  ? <p className="mt-1">{check.failed}</p>
                  : (
                    <div className="mt-1 space-y-0.5">
                      <p>
                        {check.wrote
                          ? `${check.wrote} will write — try again.`
                          : `Not one of the ${check.tried.length} models tried would write.`}
                      </p>
                      {check.tried.map((t) => (
                        <p key={t.model} className="font-mono text-[11px] leading-snug">
                          {t.model}: {t.ok ? 'ready' : `${t.status} ${t.reason}`}
                        </p>
                      ))}
                    </div>
                  )
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
