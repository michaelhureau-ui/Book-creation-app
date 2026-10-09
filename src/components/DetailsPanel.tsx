import clsx from 'clsx'
import { Field, Modal } from '@/components/ui'
import { BookCover } from '@/components/BookCover'
import { CoverArtControls } from '@/components/CoverArtControls'
import { useStore } from '@/lib/store'
import { LAYOUTS, PALETTES } from '@/lib/cover'
import { bookStats, formatCount, formatReadingTime } from '@/lib/stats'
import type { Book } from '@/types'

export function DetailsPanel({ book, onClose }: { book: Book; onClose: () => void }) {
  const updateBook = useStore((s) => s.updateBook)
  const updateCover = useStore((s) => s.updateCover)
  const stats = bookStats(book)

  return (
    <Modal
      title="Book details"
      subtitle="Title page, jacket, and metadata used by every export."
      wide
      onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <div className="grid gap-6 md:grid-cols-[1fr_15rem]">
        <div className="space-y-4">
          <Field label="Title" value={book.title} placeholder="Untitled book" onChange={(v) => updateBook(book.id, { title: v })} />
          <Field label="Subtitle" value={book.subtitle} placeholder="Optional" onChange={(v) => updateBook(book.id, { subtitle: v })} />
          <Field label="Author" value={book.author} placeholder="Your name" onChange={(v) => updateBook(book.id, { author: v })} />
          <Field
            label="Description"
            value={book.description}
            multiline
            rows={4}
            placeholder="The back-cover blurb. Included in EPUB and Word metadata."
            onChange={(v) => updateBook(book.id, { description: v })}
          />
          <label className="block">
            <span className="label">Language</span>
            <input
              className="field w-32"
              value={book.language}
              maxLength={12}
              placeholder="en"
              onChange={(e) => updateBook(book.id, { language: e.target.value })}
            />
            <span className="mt-1 block text-xs text-ink-faint">
              A BCP-47 code such as <code className="font-mono">en</code> or <code className="font-mono">fr-CA</code>. E-readers use it for hyphenation.
            </span>
          </label>
        </div>

        <div>
          <BookCover book={book} className="w-full" />

          <div className="mt-4">
            <span className="label">Jacket colour</span>
            <div className="flex flex-wrap gap-1.5">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  title={p.label}
                  aria-label={p.label}
                  aria-pressed={book.cover.palette === p.id}
                  className={clsx(
                    'h-7 w-7 rounded-full border-2 transition-transform',
                    book.cover.palette === p.id ? 'scale-110 border-accent' : 'border-rule hover:scale-105',
                  )}
                  style={{ background: p.bg }}
                  onClick={() => updateCover(book.id, { palette: p.id })}
                />
              ))}
            </div>
          </div>

          <div className="mt-4">
            <span className="label">Layout</span>
            <div className="flex gap-1">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  aria-pressed={book.cover.layout === l.id}
                  className={clsx(
                    'btn flex-1 px-2 py-1 text-xs',
                    book.cover.layout === l.id ? 'btn-primary' : 'btn-outline',
                  )}
                  onClick={() => updateCover(book.id, { layout: l.id })}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <CoverArtControls book={book} />

          <dl className="mt-5 space-y-1.5 border-t border-rule pt-4 text-sm">
            {[
              ['Words', formatCount(stats.words)],
              ['Chapters', String(stats.chapters)],
              ['Reading time', formatReadingTime(stats.readingMinutes)],
            ].map(([term, value]) => (
              <div key={term} className="flex justify-between">
                <dt className="text-ink-faint">{term}</dt>
                <dd className="font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Modal>
  )
}
