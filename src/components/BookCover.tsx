import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { Book } from '@/types'
import { bookAuthor, bookTitle } from '@/lib/book'
import { paletteOf } from '@/lib/cover'
import { assetUrl } from '@/lib/graphic/assets'

/**
 * The jacket picture, once it is out of the database.
 *
 * Covers work without one — the palette and the lettering are a whole cover on
 * their own, and every book here starts that way — so this resolves to nothing
 * and the jacket simply carries on without it.
 */
function useCoverArt(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!id) { setUrl(null); return }
    let live = true
    void assetUrl(id).then((found) => { if (live) setUrl(found) })
    return () => { live = false }
  }, [id])
  return url
}

/**
 * A book always has a presentable jacket: the palette and layout alone make
 * one, and a picture — drawn here or brought in from a file — sits under the
 * lettering when there is one.
 */
export function BookCover({ book, className, compact }: { book: Book; className?: string; compact?: boolean }) {
  const p = paletteOf(book.cover.palette)
  const title = bookTitle(book)
  const author = bookAuthor(book)
  const subtitle = book.subtitle.trim()
  const { layout } = book.cover
  const art = useCoverArt(book.cover.art)
  // A picture behind the title needs the title to stay readable over it; one in
  // a window above the title does not.
  const window = book.cover.artFit === 'window'

  return (
    <div
      className={clsx(
        'relative flex aspect-[2/3] flex-col overflow-hidden rounded-r-md rounded-l-sm shadow-book',
        className,
      )}
      style={{ background: p.bg, color: p.fg }}
    >
      {art && !window && (
        <>
          <img src={art} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          {/* Dark at the top and bottom where the lettering goes, clear through
              the middle so the picture is still a picture. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                `linear-gradient(180deg, ${p.bg}f2 0%, ${p.bg}b3 22%, ${p.bg}26 45%,`
                + ` ${p.bg}59 78%, ${p.bg}ef 100%)`,
            }}
          />
        </>
      )}

      {/* Spine shading — sells the object as a book rather than a card. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-[7%]"
        style={{ background: 'linear-gradient(90deg, rgba(0,0,0,.28), rgba(0,0,0,0))' }}
      />

      {layout === 'band' && (
        <div className="absolute inset-x-0 top-[22%] h-[34%]" style={{ background: p.accent, opacity: 0.92 }} />
      )}

      {art && window && (
        <div className="relative mx-[10%] mt-[10%] overflow-hidden rounded-sm shadow-sm">
          <img src={art} alt="" className="aspect-[4/3] w-full object-cover" />
        </div>
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
