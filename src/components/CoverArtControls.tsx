import { useRef, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '@/lib/store'
import { ACCEPTED_TYPES, removeAsset } from '@/lib/graphic/assets'
import { drawCoverArt, importCoverArt, suggestCoverBrief } from '@/lib/cover-art'
import { GenerationFailed, NOT_CONFIGURED_HELP } from '@/lib/graphic/generate'
import { STYLES, type ArtStyle } from '@/lib/graphic/image-prompt'
import type { Book } from '@/types'

/**
 * Making the one picture a reader sees first.
 *
 * Two ways in, because both are real: draw it here from a description, or bring
 * in a photograph or a drawing of your own. Either way it lands as an ordinary
 * asset on the book, so it travels into every export and the backup file.
 */
export function CoverArtControls({ book }: { book: Book }) {
  const updateCover = useStore((s) => s.updateCover)
  const [brief, setBrief] = useState(book.cover.artBrief ?? '')
  const [style, setStyle] = useState<ArtStyle>('storybook')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const asked = brief.trim() || suggestCoverBrief(book)

  const put = (art: string, usedBrief: string): void => {
    // The old picture is no longer anybody's, so it does not sit in the
    // database forever taking up room.
    const old = book.cover.art
    updateCover(book.id, { art, artBrief: usedBrief, artFit: book.cover.artFit ?? 'full' })
    if (old && old !== art) void removeAsset(old)
  }

  const draw = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      put(await drawCoverArt(book, asked, style), asked)
      setBrief(asked)
    } catch (err) {
      if (err instanceof GenerationFailed) setError({ code: err.code, message: err.message })
      else setError({ code: 'provider_error', message: 'The picture could not be drawn.' })
    } finally {
      setBusy(false)
    }
  }

  const bringIn = async (chosen: File | undefined): Promise<void> => {
    if (!chosen || busy) return
    setBusy(true)
    setError(null)
    try {
      put(await importCoverArt(book, chosen), chosen.name)
    } catch (err) {
      setError({ code: 'unreadable', message: err instanceof Error ? err.message : 'That picture could not be read.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-rule pt-4">
      <span className="label">Cover picture</span>

      <textarea
        className="field h-16 w-full resize-none text-xs"
        value={brief}
        disabled={busy}
        maxLength={600}
        placeholder={suggestCoverBrief(book)}
        onChange={(e) => setBrief(e.target.value)}
        aria-label="What should be on the cover"
      />

      <select
        className="field mt-2 w-full text-xs"
        value={style}
        disabled={busy}
        aria-label="Cover picture style"
        onChange={(e) => setStyle(e.target.value as ArtStyle)}
      >
        {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>

      <div className="mt-2 flex gap-1">
        <button className="btn btn-primary flex-1 px-2 py-1 text-xs" disabled={busy} onClick={() => void draw()}>
          {busy ? 'Drawing…' : book.cover.art ? 'Draw another' : 'Draw it'}
        </button>
        <button
          className="btn btn-outline px-2 py-1 text-xs"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          My own
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => { void bringIn(e.target.files?.[0]); e.target.value = '' }}
      />

      {book.cover.art && (
        <>
          <div className="mt-2 flex gap-1">
            {([['full', 'Full bleed'], ['window', 'In a window']] as const).map(([fit, label]) => (
              <button
                key={fit}
                aria-pressed={(book.cover.artFit ?? 'full') === fit}
                className={clsx(
                  'btn flex-1 px-2 py-1 text-xs',
                  (book.cover.artFit ?? 'full') === fit ? 'btn-primary' : 'btn-outline',
                )}
                onClick={() => updateCover(book.id, { artFit: fit })}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="mt-1 w-full text-xs text-ink-faint underline"
            disabled={busy}
            onClick={() => {
              const old = book.cover.art
              updateCover(book.id, { art: undefined })
              if (old) void removeAsset(old)
            }}
          >
            Take the picture off
          </button>
        </>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <p>{error.message}</p>
          {error.code === 'not_configured' && <p className="mt-1">{NOT_CONFIGURED_HELP}</p>}
        </div>
      )}
    </div>
  )
}
