import clsx from 'clsx'
import type { Book } from '@/types'
import { bookAuthor, bookTitle } from '@/lib/book'
import { paletteOf } from '@/lib/cover'

/**
 * Covers are generated from the palette + layout rather than uploaded, so a
 * book always has a presentable jacket without the writer sourcing artwork.
 */
export function BookCover({ book, className, compact }: { book: Book; className?: string; compact?: boolean }) {
  const p = paletteOf(book.cover.palette)
  const title = bookTitle(book)
  const author = bookAuthor(book)
  const subtitle = book.subtitle.trim()
  const { layout } = book.cover

  return (
    <div
      className={clsx(
        'relative flex aspect-[2/3] flex-col overflow-hidden rounded-r-md rounded-l-sm shadow-book',
        className,
      )}
      style={{ background: p.bg, color: p.fg }}
    >
      {/* Spine shading — sells the object as a book rather than a card. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-[7%]"
        style={{ background: 'linear-gradient(90deg, rgba(0,0,0,.28), rgba(0,0,0,0))' }}
      />

      {layout === 'band' && (
        <div className="absolute inset-x-0 top-[22%] h-[34%]" style={{ background: p.accent, opacity: 0.92 }} />
      )}

      <div
        className={clsx(
          'relative flex flex-1 flex-col px-[10%] text-center',
          layout === 'minimal' ? 'justify-end pb-[14%]' : 'justify-center',
        )}
      >
        {layout === 'classic' && (
          <div className="mx-auto mb-[8%] h-px w-[45%]" style={{ background: p.muted, opacity: 0.7 }} />
        )}
        <h3
          className={clsx(
            'font-serif font-semibold leading-tight',
            compact ? 'text-[0.95rem]' : 'text-[1.6rem]',
          )}
          style={{ color: layout === 'band' ? p.bg : p.fg }}
        >
          {title}
        </h3>
        {subtitle && (
          <p
            className={clsx('mt-[4%] font-serif italic leading-snug', compact ? 'text-[0.6rem]' : 'text-[0.9rem]')}
            style={{ color: layout === 'band' ? p.bg : p.muted }}
          >
            {subtitle}
          </p>
        )}
        {layout === 'classic' && (
          <div className="mx-auto mt-[8%] h-px w-[45%]" style={{ background: p.muted, opacity: 0.7 }} />
        )}
      </div>

      <div className="relative px-[10%] pb-[9%] text-center">
        <p
          className={clsx('font-sans uppercase tracking-[0.18em]', compact ? 'text-[0.5rem]' : 'text-[0.7rem]')}
          style={{ color: p.muted }}
        >
          {author}
        </p>
      </div>
    </div>
  )
}
