import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { MicButton } from '@/components/MicButton'
import { Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import {
  checkStoryService, drawPanels, NOT_CONFIGURED_HELP, QUOTA_HELP, STALE_BUILD_HELP, StoryFailed,
  writeStory, type DrawingProgress, type ServiceCheck, type StoryProgress,
} from '@/lib/story/generate'
import { MAX_IDEA_LENGTH, MAX_SHOW_LENGTH, pagesIn } from '@/lib/story/limits'
import { clearDraft, draftHasWriting, loadDraft, saveDraft } from '@/lib/story/draft'
import { STYLES, type ArtStyle } from '@/lib/graphic/image-prompt'
import type { BookKind } from '@/types'
import type { StoryLength } from '@/lib/story/story'

const KINDS: { id: BookKind; name: string; hint: string; icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'prose', name: 'Novel', hint: 'Chapters of written text.', icon: Icons.Book },
  { id: 'graphic', name: 'Graphic novel', hint: 'Pages of panels and balloons.', icon: Icons.Panels },
]

/**
 * The lengths on offer, with a rough wait — a long book really does take a
 * long time. The page counts come from the shapes rather than being written
 * out here, because a graphic novel's lengths are nothing like a novel's: a
 * comic is twenty-four pages, not two hundred.
 */
const LENGTHS: { id: StoryLength; label: string; wait: string; note: Record<BookKind, string> }[] = [
  { id: 'short', label: 'Short', wait: 'a few minutes', note: { prose: '', graphic: 'one issue' } },
  { id: 'medium', label: 'Medium', wait: 'around ten minutes', note: { prose: '', graphic: 'a collection' } },
  { id: 'long', label: 'Long', wait: 'up to half an hour', note: { prose: '', graphic: 'a whole book' } },
]

const AUDIENCES: { id: string; label: string }[] = [
  { id: 'children', label: 'Young children' },
  { id: 'middle', label: 'Older children' },
  { id: 'teen', label: 'Teenagers' },
  { id: 'adult', label: 'Grown-ups' },
]

const SOURCES: { id: 'own' | 'show'; label: string; hint: string }[] = [
  { id: 'own', label: 'My own idea', hint: 'Anything you like.' },
  { id: 'show', label: 'A show or film', hint: 'A new story set in its world.' },
]

const EXAMPLES = [
  'a fox who runs a lost property office at the bottom of the sea',
  'two sisters who find a door in the orchard that only opens in the rain',
  'the last lighthouse keeper on a planet with three moons',
]

export function StoryDialog({ onClose }: { onClose: () => void }) {
  const importBook = useStore((s) => s.importBook)
  const addStoryChapter = useStore((s) => s.addStoryChapter)
  const setPanelArt = useStore((s) => s.setPanelArt)
  const openBook = useStore((s) => s.openBook)
  const books = useStore((s) => s.books)

  // Whatever was typed last time this form was open. Describing a book takes
  // thought, and closing the form used to throw that thought away.
  const [draft] = useState(() => loadDraft())
  const [restored, setRestored] = useState(() => draftHasWriting(draft))

  const [source, setSource] = useState<'own' | 'show'>(draft?.source ?? 'own')
  const [show, setShow] = useState(draft?.show ?? '')
  const [retell, setRetell] = useState(draft?.retell ?? false)
  const [idea, setIdea] = useState(draft?.idea ?? '')
  const [kind, setKind] = useState<BookKind>(draft?.kind ?? 'prose')
  const [length, setLength] = useState<StoryLength>(draft?.length ?? 'short')
  const [audience, setAudience] = useState(draft?.audience ?? 'middle')
  const [draw, setDraw] = useState(draft?.draw ?? false)
  const [style, setStyle] = useState<ArtStyle>(draft?.style ?? 'color')
  const [progress, setProgress] = useState<StoryProgress | null>(null)
  const [drawing, setDrawing] = useState<DrawingProgress | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [check, setCheck] = useState<ServiceCheck | 'running' | { failed: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The book is in the library from the first chapter, so stopping keeps it.
  const startedRef = useRef<string | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  // Kept as it is typed, so closing the form — or the tab, or the laptop lid —
  // costs nothing.
  useEffect(() => {
    saveDraft({ source, show, retell, idea, kind, length, audience, draw, style })
  }, [source, show, retell, idea, kind, length, audience, draw, style])

  const busy = progress !== null
  const chosen = LENGTHS.find((l) => l.id === length) ?? LENGTHS[0]
  const named = source === 'show' ? show.trim() : ''
  const ready = source === 'show' ? named.length > 0 : idea.trim().length > 0

  const finish = (): void => {
    if (startedRef.current) openBook(startedRef.current)
    onClose()
  }

  const write = async (): Promise<void> => {
    if (busy) return
    setError(null)
    setDrawing(null)
    startedRef.current = null
    setProgress({ done: 0, total: 1, label: 'Planning the book…' })
    const controller = new AbortController()
    abortRef.current = controller

    try {
      clearDraft()
      const { bookId } = await writeStory(idea, kind, length, audience, {
        onProgress: setProgress,
        onStart: async (book) => {
          const id = await importBook(book)
          startedRef.current = id
          return id
        },
        onChapter: (id, chapter, pages) => addStoryChapter(id, chapter, pages),
      }, controller.signal, named, retell)

      if (kind === 'graphic' && draw && !controller.signal.aborted) {
        setProgress({ done: 1, total: 1, label: 'Drawing the pictures…' })
        // Read the book back from the store: it now holds every chapter.
        const written = useStore.getState().books.find((b) => b.id === bookId)
        if (written) {
          const result = await drawPanels(
            written, style,
            (pageId, panelId, assetId) => setPanelArt(bookId, pageId, panelId, assetId),
            setDrawing, controller.signal,
          )
          if (result.stopped) {
            setError({ code: 'drawing_stopped', message: result.stopped })
            setProgress(null)
            return
          }
        }
      }
      finish()
    } catch (err) {
      if (controller.signal.aborted) { finish(); return }
      if (err instanceof StoryFailed) setError({ code: err.code, message: err.message })
      else setError({ code: 'provider_error', message: 'The story could not be written.' })
      setProgress(null)
    } finally {
      abortRef.current = null
    }
  }

  const share = drawing && drawing.total > 0
    ? drawing.drawn / drawing.total
    : progress && progress.total > 0 ? progress.done / progress.total : 0

  // Written but unfinished: the chapters already in the library are keepers.
  const partial = startedRef.current
    ? books.find((b) => b.id === startedRef.current)?.chapters.length ?? 0
    : 0

  return (
    <Modal
      title="Write me a story"
      subtitle="Say what it is about, and the book gets written for you."
      onClose={() => { abortRef.current?.abort(); finish() }}
      footer={
        <>
          <button className="btn btn-outline" onClick={() => { abortRef.current?.abort(); finish() }}>
            {busy ? (partial > 0 ? 'Stop and keep it' : 'Stop') : 'Cancel'}
          </button>
          <button className="btn btn-primary" disabled={busy || !ready} onClick={() => void write()}>
            {busy ? 'Writing…' : <><Icons.Sparkle className="h-4 w-4" /> Write the story</>}
          </button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void write() }}>
        <div>
          <span className="label">Where does it come from?</span>
          <div className="grid grid-cols-2 gap-2">
            {SOURCES.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                className={clsx(
                  'rounded-lg border p-2.5 text-left transition-colors disabled:opacity-50',
                  source === option.id
                    ? 'border-accent bg-accent-soft/60'
                    : 'border-rule hover:border-rule-strong hover:bg-paper-sunk',
                )}
                onClick={() => setSource(option.id)}
              >
                <span className="block text-sm font-semibold text-ink">{option.label}</span>
                <span className="block text-xs text-ink-faint">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {source === 'show' && (
          <div>
            <label className="label" htmlFor="story-show">Which show or film?</label>
            <div className="flex items-center gap-1.5">
              <input
                id="story-show"
                autoFocus
                className="field py-2"
                maxLength={MAX_SHOW_LENGTH}
                value={show}
                disabled={busy}
                placeholder="How to Train Your Dragon"
                onChange={(e) => setShow(e.target.value)}
              />
              <MicButton
                label="Say which show or film"
                disabled={busy}
                className="shrink-0"
                onText={(said) => setShow((was) => (was ? `${was} ${said}` : said))}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {([[false, 'A new adventure'], [true, 'Its own story again']] as const).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  disabled={busy}
                  className={clsx(
                    'rounded-md border px-2 py-1.5 text-xs transition-colors disabled:opacity-50',
                    retell === value
                      ? 'border-accent bg-accent-soft/60 font-semibold text-accent-deep'
                      : 'border-rule text-ink-soft hover:bg-paper-sunk',
                  )}
                  onClick={() => setRetell(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              It uses the real characters and places. The pictures are drawn from written
              descriptions of how they look, so they will be close but not exact — the
              picture service refuses a character asked for by name.
            </p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="story-idea">
            {source === 'show' ? 'What should happen in it? (optional)' : 'What is the story about?'}
          </label>
          <div className="flex items-start gap-1.5">
            <textarea
              id="story-idea"
              autoFocus
              className="field resize-y py-2"
              rows={3}
              maxLength={MAX_IDEA_LENGTH}
              value={idea}
              disabled={busy}
              placeholder={source === 'show'
                ? 'they find a cave nobody has been inside'
                : 'a fox who runs a lost property office at the bottom of the sea'}
              onChange={(e) => setIdea(e.target.value)}
            />
            <div className="shrink-0 pt-1">
              <MicButton
                label="Say what the story is about"
                disabled={busy}
                onText={(said) => setIdea((was) => (was ? `${was} ${said}` : said))}
              />
            </div>
          </div>
          {!idea.trim() && !busy && source === 'own' && (
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
                    {pagesIn(kind, option.id)} pages
                  </span>
                  {option.note[kind] && (
                    <span className="block text-[0.6rem] font-normal opacity-70">
                      {option.note[kind]}
                    </span>
                  )}
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

        {!busy && (
          <p className="text-xs text-ink-faint">
            {pagesIn(kind, chosen.id)} pages takes {chosen.wait}. Each chapter is kept as it is written, so you
            can stop early and still have a book.
          </p>
        )}

        {kind === 'graphic' && (
          <div className="rounded-lg border border-rule bg-paper-sunk/50 p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={draw}
                disabled={busy}
                onChange={(e) => setDraw(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">Draw the pictures too</span>
                <span className="block text-xs text-ink-faint">
                  Every panel is drawn from the story, using the same key as the picture-maker.
                  That is hundreds of pictures for a book this long, so it stops when your
                  allowance runs out and keeps what it drew. You can always draw the rest yourself.
                </span>
              </span>
            </label>
            {draw && (
              <select
                className="field mt-2 py-1.5 text-sm"
                value={style}
                disabled={busy}
                aria-label="Art style"
                onChange={(e) => setStyle(e.target.value as ArtStyle)}
              >
                {STYLES.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {busy && progress && (
          <div className="rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(4, share * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {drawing ? `Drawing picture ${drawing.drawn + 1} of ${drawing.total}…` : progress.label}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint">
              {partial > 0
                ? `${partial} ${partial === 1 ? 'chapter is' : 'chapters are'} already saved. You can stop and keep them.`
                : 'Leave this open.'}
            </p>
          </div>
        )}

        {restored && !busy && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-rule bg-paper-sunk/60 p-2 text-xs text-ink-soft">
            <p>Picked up where you left off — this is what you typed last time.</p>
            <button
              type="button"
              className="shrink-0 font-semibold underline"
              onClick={() => {
                setSource('own'); setShow(''); setRetell(false); setIdea('')
                setDraw(false); setRestored(false); clearDraft()
              }}
            >
              Start fresh
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">{error.message}</p>
            {error.code === 'not_configured' && <p className="mt-1">{NOT_CONFIGURED_HELP}</p>}
            {error.code === 'quota' && <p className="mt-1">{QUOTA_HELP}</p>}
            {error.code === 'stale_build' && <p className="mt-1">{STALE_BUILD_HELP}</p>}
            {error.code === 'drawing_stopped' && (
              <p className="mt-1">
                The book is written and saved — only the pictures stopped. Open it and draw the
                rest from each panel whenever you like.
              </p>
            )}
            {partial > 0 && error.code !== 'drawing_stopped' && (
              <p className="mt-1">
                {partial} {partial === 1 ? 'chapter was' : 'chapters were'} written and saved before
                this happened. Close this to read what there is.
              </p>
            )}
            {error.code !== 'drawing_stopped' && error.code !== 'empty_idea' && (
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
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}
