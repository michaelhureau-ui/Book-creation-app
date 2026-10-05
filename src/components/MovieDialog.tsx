import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { Modal } from '@/components/ui'
import { downloadBlob } from '@/lib/export'
import { slugify } from '@/lib/book'
import { bookStats } from '@/lib/stats'
import { DEFAULT_FILM, filmSeconds, shotList, type MotionStyle } from '@/lib/movie/film'
import { fileExtension, pickMimeType, recordFilm, type Film, type FilmProgress } from '@/lib/movie/record'
import type { Book } from '@/types'

const MOTIONS: { id: MotionStyle; label: string; hint: string }[] = [
  { id: 'panels', label: 'Panel by panel', hint: 'Moves through each picture, like a comic read aloud.' },
  { id: 'pages', label: 'Whole pages', hint: 'Holds on each page and drifts across it.' },
]

const PACES: { id: number; label: string }[] = [
  { id: 1.8, label: 'Quick' },
  { id: 2.6, label: 'Steady' },
  { id: 3.8, label: 'Slow' },
]

function clock(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * A film of the book, made out of the book.
 *
 * The pictures come from the renderer that already backs the editor, the
 * preview and the exports, so the film cannot drift from the thing it is of.
 * It records in real time because that is what the browser's recorder
 * captures — and because a book is watched at the speed it is read.
 */
export function MovieDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [motion, setMotion] = useState<MotionStyle>(DEFAULT_FILM.motion)
  const [pace, setPace] = useState<number>(DEFAULT_FILM.pace)
  const [progress, setProgress] = useState<FilmProgress | null>(null)
  const [film, setFilm] = useState<Film | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const stats = bookStats(book)
  const supported = pickMimeType() !== null
  const shots = shotList(book, { motion, pace })
  const length = filmSeconds(shots)
  const busy = progress !== null

  const make = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas || busy) return
    setError(null)
    setFilm(null)
    setProgress({ share: 0, label: 'Getting ready…' })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      setFilm(await recordFilm(book, canvas, { motion, pace }, setProgress, controller.signal))
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error && err.message !== 'stopped'
          ? err.message
          : 'The film could not be made.')
      }
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const save = (): void => {
    if (!film) return
    downloadBlob(film.blob, `${slugify(book.title)}.${fileExtension(film.mime)}`)
  }

  return (
    <Modal
      title="Make a movie"
      subtitle={`${clock(length)} from ${stats.pages} ${stats.pages === 1 ? 'page' : 'pages'}`}
      wide
      onClose={() => { abortRef.current?.abort(); onClose() }}
      footer={
        <>
          <button
            className="btn btn-outline"
            onClick={() => { abortRef.current?.abort(); onClose() }}
          >
            {busy ? 'Stop' : 'Close'}
          </button>
          {film
            ? <button className="btn btn-primary" onClick={save}><Icons.Download /> Save the movie</button>
            : (
              <button className="btn btn-primary" disabled={busy || !supported} onClick={() => void make()}>
                <Icons.Film className="h-4 w-4" /> {busy ? 'Filming…' : 'Make it'}
              </button>
            )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg bg-black">
          <canvas ref={canvasRef} className="block aspect-video w-full" />
        </div>

        {book.kind !== 'graphic' && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            A novel has no pictures to film, so this is a title sequence — the cover and
            every chapter. For a film of the story itself, make a graphic novel.
          </p>
        )}

        {!supported && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            This browser cannot record video. Chrome, Edge or Safari on a recent version can.
          </p>
        )}

        {!busy && !film && (
          <>
            {book.kind === 'graphic' && (
              <div>
                <span className="label">How should it move?</span>
                <div className="grid grid-cols-2 gap-2">
                  {MOTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={clsx(
                        'rounded-lg border p-2.5 text-left transition-colors',
                        motion === option.id
                          ? 'border-accent bg-accent-soft/60'
                          : 'border-rule hover:border-rule-strong hover:bg-paper-sunk',
                      )}
                      onClick={() => setMotion(option.id)}
                    >
                      <span className="block text-sm font-semibold text-ink">{option.label}</span>
                      <span className="block text-xs text-ink-faint">{option.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <span className="label">How fast?</span>
              <div className="grid grid-cols-3 gap-1">
                {PACES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={clsx(
                      'rounded-md border px-1 py-1.5 text-xs transition-colors',
                      pace === option.id
                        ? 'border-accent bg-accent-soft/60 font-semibold text-accent-deep'
                        : 'border-rule text-ink-soft hover:bg-paper-sunk',
                    )}
                    onClick={() => setPace(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-ink-faint">
              The film is made at the speed you would watch it, so it takes about {clock(length)} to
              record — the picture above is what is being filmed. The look comes from the artwork
              itself: choose <em>3D animated film</em>, <em>Storybook painting</em> or any other
              style when you make the pictures, and the movie inherits it.
            </p>
          </>
        )}

        {busy && progress && (
          <div className="rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.max(3, progress.share * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-soft">{progress.label}</p>
          </div>
        )}

        {film && (
          <p className="rounded-lg border border-rule bg-paper-sunk/60 p-3 text-sm text-ink-soft">
            Done — {clock(film.seconds)} of film, {(film.blob.size / 1_000_000).toFixed(1)} MB.
            Save it, or make another at a different speed.
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>
        )}
      </div>
    </Modal>
  )
}
