import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import {
  NOT_CONFIGURED_HELP, STALE_BUILD_HELP, StoryFailed, writeStory, type StoryProgress,
} from '@/lib/story/generate'
import { MAX_IDEA_LENGTH } from '@/lib/story/limits'
import type { BookKind } from '@/types'
import type { StoryLength } from '@/lib/story/story'

const KINDS: { id: BookKind; name: string; hint: string; icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'prose', name: 'Novel', hint: 'Chapters of written text.', icon: Icons.Book },
  { id: 'graphic', name: 'Graphic novel', hint: 'Pages of panels and balloons.', icon: Icons.Panels },
]

const LENGTHS: { id: StoryLength; label: string; hint: string }[] = [
  { id: 'short', label: 'Short', hint: 'A few chapters' },
  { id: 'medium', label: 'Medium', hint: 'A proper story' },
  { id: 'long', label: 'Long', hint: 'Takes a while' },
]

const AUDIENCES: { id: string; label: string }[] = [
  { id: 'children', label: 'Young children' },
  { id: 'middle', label: 'Older children' },
  { id: 'teen', label: 'Teenagers' },
  { id: 'adult', label: 'Grown-ups' },
]

const EXAMPLES = [
  'a fox who runs a lost property office at the bottom of the sea',
  'two sisters who find a door in the orchard that only opens in the rain',
  'the last lighthouse keeper on a planet with three moons',
]

export function StoryDialog({ onClose }: { onClose: () => void }) {
  const importBook = useStore((s) => s.importBook)
  const openBook = useStore((s) => s.openBook)

  const [idea, setIdea] = useState('')
  const [kind, setKind] = useState<BookKind>('prose')
  const [length, setLength] = useState<StoryLength>('short')
  const [audience, setAudience] = useState('middle')
  const [progress, setProgress] = useState<StoryProgress | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Walking away mid-write should not leave the request running.
  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = progress !== null

  const write = async (): Promise<void> => {
    if (busy) return
    setError(null)
    setProgress({ done: 0, total: 1, label: 'Planning the book…' })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const book = await writeStory(idea, kind, length, audience, setProgress, controller.signal)
      const id = await importBook(book)
      openBook(id)
      onClose()
    } catch (err) {
      if (controller.signal.aborted) return
      if (err instanceof StoryFailed) setError({ code: err.code, message: err.message })
      else setError({ code: 'provider_error', message: 'The story could not be written.' })
      setProgress(null)
    } finally {
      abortRef.current = null
    }
  }

  const share = progress && progress.total > 0 ? progress.done / progress.total : 0

  return (
    <Modal
      title="Write me a story"
      subtitle="Say what it is about, and the book gets written for you."
      onClose={busy ? () => { abortRef.current?.abort(); onClose() } : onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={() => { abortRef.current?.abort(); onClose() }}>
            {busy ? 'Stop' : 'Cancel'}
          </button>
          <button className="btn btn-primary" disabled={busy || !idea.trim()} onClick={() => void write()}>
            {busy ? 'Writing…' : <><Icons.Sparkle className="h-4 w-4" /> Write the story</>}
          </button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void write() }}>
        <div>
          <label className="label" htmlFor="story-idea">What is the story about?</label>
          <textarea
            id="story-idea"
            autoFocus
            className="field resize-y py-2"
            rows={3}
            maxLength={MAX_IDEA_LENGTH}
            value={idea}
            disabled={busy}
            placeholder="a fox who runs a lost property office at the bottom of the sea"
            onChange={(e) => setIdea(e.target.value)}
          />
          {!idea.trim() && !busy && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="text-xs text-ink-faint">Try:</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="rounded-md border border-rule px-1.5 py-0.5 text-left text-[0.7rem] text-ink-soft hover:border-accent hover:text-ink"
                  onClick={() => setIdea(example)}
                >
                  {example.length > 42 ? `${example.slice(0, 40)}…` : example}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="label">What should it be?</span>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={busy}
                  className={clsx(
                    'rounded-lg border p-3 text-left transition-colors disabled:opacity-50',
                    kind === option.id
                      ? 'border-accent bg-accent-soft/60'
                      : 'border-rule hover:border-rule-strong hover:bg-paper-sunk',
                  )}
                  onClick={() => setKind(option.id)}
                >
                  <Icon className="h-4 w-4 text-accent-deep" />
                  <span className="mt-1 block text-sm font-semibold text-ink">{option.name}</span>
                  <span className="block text-xs text-ink-faint">{option.hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">How long?</span>
            <div className="grid grid-cols-3 gap-1">
              {LENGTHS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={busy}
                  title={option.hint}
                  className={clsx(
                    'rounded-md border px-1 py-1.5 text-xs transition-colors disabled:opacity-50',
                    length === option.id
                      ? 'border-accent bg-accent-soft/60 font-semibold text-accent-deep'
                      : 'border-rule text-ink-soft hover:bg-paper-sunk',
                  )}
                  onClick={() => setLength(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="story-audience">Who is it for?</label>
            <select
              id="story-audience"
              className="field py-1.5 text-sm"
              value={audience}
              disabled={busy}
              onChange={(e) => setAudience(e.target.value)}
            >
              {AUDIENCES.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {busy && progress && (
          <div className="rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(6, share * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-soft">{progress.label}</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              A longer book takes longer — this can run a couple of minutes. Leave this open.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">{error.message}</p>
            {error.code === 'not_configured' && <p className="mt-1">{NOT_CONFIGURED_HELP}</p>}
            {error.code === 'stale_build' && <p className="mt-1">{STALE_BUILD_HELP}</p>}
          </div>
        )}
      </form>
    </Modal>
  )
}
