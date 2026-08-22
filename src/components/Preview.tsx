import { Fragment, useMemo } from 'react'
import { Modal } from '@/components/ui'
import { BookCover } from '@/components/BookCover'
import { parseBlocks, type Block, type Run } from '@/lib/blocks'
import { bookAuthor, bookTitle, chapterNumbers } from '@/lib/book'
import { bookStats, formatCount, readingSummary } from '@/lib/stats'
import type { Book } from '@/types'

/**
 * Rendered from the parsed block model rather than the stored HTML: an
 * imported project file is untrusted input, and going through the same
 * representation the exporters use keeps preview and output in step.
 */
function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) => {
        if (run.text === '\n') return <br key={i} />
        let node: React.ReactNode = run.text
        if (run.code) node = <code>{node}</code>
        if (run.bold) node = <strong>{node}</strong>
        if (run.italic) node = <em>{node}</em>
        if (run.underline) node = <u>{node}</u>
        if (run.strike) node = <s>{node}</s>
        return <Fragment key={i}>{node}</Fragment>
      })}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3'] as const)[block.level - 1]
      return <Tag><Runs runs={block.runs} /></Tag>
    }
    case 'quote':
      return <blockquote><p><Runs runs={block.runs} /></p></blockquote>
    case 'code':
      return <pre><code>{block.text}</code></pre>
    case 'rule':
      return <hr />
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag>
          {block.items.map((item, i) => <li key={i}><Runs runs={item} /></li>)}
        </Tag>
      )
    }
    default:
      return <p><Runs runs={block.runs} /></p>
  }
}

export function Preview({ book, onClose }: { book: Book; onClose: () => void }) {
  const numbers = useMemo(() => chapterNumbers(book.chapters), [book.chapters])
  const parsed = useMemo(
    () => book.chapters.map((c) => ({ chapter: c, blocks: parseBlocks(c.content) })),
    [book.chapters],
  )
  const stats = useMemo(() => bookStats(book), [book])

  return (
    <Modal
      title="Preview"
      subtitle={`${formatCount(stats.words)} words · ${readingSummary(stats.readingMinutes)}`}
      wide
      onClose={onClose}
      footer={<button className="btn btn-outline" onClick={onClose}>Close preview</button>}
    >
      <div className="max-h-[70vh] overflow-y-auto scrollbar-slim rounded-xl bg-paper-sunk p-4 sm:p-8">
        {/* Jacket */}
        <div className="mx-auto mb-10 w-44">
          <BookCover book={book} compact className="w-full" />
        </div>

        {/* Title page */}
        <section className="mx-auto mb-12 max-w-[34rem] rounded-lg bg-paper-raised px-8 py-16 text-center shadow-card">
          <h1 className="font-serif text-3xl font-semibold leading-tight text-ink">{bookTitle(book)}</h1>
          {book.subtitle.trim() && (
            <p className="mt-3 font-serif text-lg italic text-ink-soft">{book.subtitle.trim()}</p>
          )}
          <p className="mt-10 text-sm uppercase tracking-[0.18em] text-ink-faint">{bookAuthor(book)}</p>
        </section>

        {/* Contents */}
        {book.chapters.length > 0 && (
          <section className="mx-auto mb-12 max-w-[34rem] rounded-lg bg-paper-raised px-8 py-10 shadow-card">
            <h2 className="mb-5 text-center font-serif text-xl font-semibold text-ink">Contents</h2>
            <ol className="space-y-1.5">
              {book.chapters.map((c) => {
                const n = numbers.get(c.id)
                return (
                  <li key={c.id} className="flex gap-2 font-serif text-sm text-ink-soft">
                    <span className="shrink-0">{n ? `${n}.` : '—'}</span>
                    <span className="truncate">{c.title || 'Untitled'}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {/* Body */}
        {parsed.map(({ chapter, blocks }) => (
          <section key={chapter.id} className="mx-auto mb-8 max-w-[34rem] rounded-lg bg-paper-raised px-8 py-12 shadow-card">
            {numbers.get(chapter.id) && (
              <p className="text-center text-xs uppercase tracking-[0.2em] text-ink-faint">
                Chapter {numbers.get(chapter.id)}
              </p>
            )}
            <h2 className="mb-8 mt-2 text-center font-serif text-2xl font-semibold text-ink">
              {chapter.title || 'Untitled'}
            </h2>
            <div className="book-page">
              {blocks.length === 0
                ? <p className="text-center italic text-ink-faint" style={{ textIndent: 0 }}>This chapter is empty.</p>
                : blocks.map((block, i) => <BlockView key={i} block={block} />)}
            </div>
          </section>
        ))}

        {book.chapters.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-faint">Add a chapter to see it here.</p>
        )}
      </div>
    </Modal>
  )
}
