import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '@/components/ui'
import { type Block, type Run } from '@/lib/blocks'
import { printSheets } from '@/lib/printing'
import { bookAuthor, bookTitle, chapterNumbers } from '@/lib/book'
import { assetIdsOf, renderPage, type TrimId } from '@/lib/graphic/render'
import { loadImages } from '@/lib/graphic/assets'
import { pageCountOf, renderWrap, spineInches } from '@/lib/export/wrap'
import type { Book } from '@/types'

/** Rendered from the parsed blocks, the same model the exporters print from. */
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
    case 'quote': return <blockquote><p><Runs runs={block.runs} /></p></blockquote>
    case 'code': return <pre><code>{block.text}</code></pre>
    case 'rule': return <hr />
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return <Tag>{block.items.map((item, i) => <li key={i}><Runs runs={item} /></li>)}</Tag>
    }
    default: return <p><Runs runs={block.runs} /></p>
  }
}

/**
 * Every page of the book as paper.
 *
 * Printing goes through the browser rather than the PDF writer, because that
 * is what reaches a printer from a phone as well as a laptop — and what lets
 * someone print a few pages rather than the whole book. The content is the
 * same parsed model the exporters use, so what comes out of the printer and
 * what comes out of the PDF are the same book.
 */
export function PrintView({ book, trim, onClose }: { book: Book; trim: TrimId; onClose: () => void }) {
  const [comicPages, setComicPages] = useState<string[] | null>(null)
  // The jacket: back cover, spine and front on one wide sheet.
  const [wrap, setWrap] = useState<string | null>(null)
  const [drawn, setDrawn] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const printed = useRef(false)

  const numbers = useMemo(() => chapterNumbers(book.chapters), [book.chapters])
  // One sheet of paper per page of the book — the same rule the PDF follows.
  const sheets = useMemo(() => printSheets(book), [book])
  const proseSheets = sheets.flatMap((sheet) => (sheet.kind === 'prose' ? [sheet] : []))

  // A comic page is artwork, so each one is rendered once and printed as an
  // image — the same renderer the preview and both exports draw through.
  useEffect(() => {
    if (book.kind !== 'graphic') { setComicPages([]); return }
    let live = true
    void (async () => {
      try {
        const images = await loadImages(assetIdsOf(book.pages))
        const out: string[] = []
        for (const page of book.pages) {
          if (!live) return
          out.push(renderPage(page, images, { trim, dpi: 150 }).toDataURL('image/jpeg', 0.9))
          setDrawn(out.length)
          // Let the browser breathe between pages, so a long comic does not
          // lock the tab solid while it is being prepared.
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        if (live) setComicPages(out)
      } catch {
        if (live) setFailed('The pages could not be prepared for printing. The PDF export still works.')
      }
    })()
    return () => { live = false }
  }, [book, trim])

  // The cover is one wide sheet rather than a page, so it is drawn on its own.
  // It is never a reason not to print: a book whose jacket will not draw still
  // prints its pages.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const canvas = await renderWrap({
          book,
          trim,
          pageCount: pageCountOf(book),
          stock: 'standard',
          dpi: 150,
          // Printed at home rather than sent to a press: no bleed to trim off
          // and no crop marks, so what comes out is the jacket itself.
          printReady: false,
        })
        if (live) setWrap(canvas.toDataURL('image/jpeg', 0.92))
      } catch { /* the pages still print */ }
    })()
    return () => { live = false }
  }, [book, trim])

  // Hand over to the printer once, as soon as there is something to print.
  useEffect(() => {
    if (comicPages === null || printed.current) return
    printed.current = true
    const timer = setTimeout(() => {
      window.print()
      onClose()
    }, 120)
    return () => clearTimeout(timer)
  }, [comicPages, onClose])

  const total = book.kind === 'graphic' ? book.pages.length : proseSheets.length
  const ready = comicPages !== null

  return (
    <>
      <Modal
        title="Print"
        subtitle={ready
          ? 'Handing the book to your printer…'
          : `Getting ${total} ${total === 1 ? 'page' : 'pages'} ready…`}
        onClose={onClose}
        footer={<button className="btn btn-outline" onClick={onClose}>Cancel</button>}
      >
        {failed ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{failed}</p>
        ) : (
          <div className="py-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${ready ? 100 : Math.max(4, (drawn / Math.max(1, total)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              {ready
                ? 'Your printer dialog should be opening.'
                : `Page ${drawn} of ${total}…`}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              Choose paper size and which pages you want in the printer dialog. To keep a file
              instead, pick “Save as PDF” there — or use Export for a typeset one.
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              The first sheet is the cover: back, spine and front side by side, with a{' '}
              {spineInches(pageCountOf(book)).toFixed(3)} in spine for {pageCountOf(book)} pages.
              It is wider than it is tall, so set that sheet to landscape, or print it on its own
              from Export → Printable cover.
            </p>
          </div>
        )}
      </Modal>

      {createPortal(
        <div className="print-root">
          {wrap && (
            <section className="print-sheet print-wrap" style={{ textAlign: 'center' }}>
              <img src={wrap} alt="The cover, spine and back cover" />
            </section>
          )}

          <section className="print-sheet" style={{ textAlign: 'center', paddingTop: '28%' }}>
            <h1 style={{ fontSize: '2.2rem', fontWeight: 600, margin: 0 }}>{bookTitle(book)}</h1>
            {book.subtitle.trim() && (
              <p style={{ fontStyle: 'italic', marginTop: '0.6rem' }}>{book.subtitle.trim()}</p>
            )}
            <p style={{ marginTop: '2.5rem', letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: '0.85rem' }}>
              {bookAuthor(book)}
            </p>
          </section>

          {book.kind === 'graphic'
            ? (comicPages ?? []).map((src, i) => (
              <section key={book.pages[i]?.id ?? i} className="print-sheet" style={{ textAlign: 'center' }}>
                <img src={src} alt={`Page ${i + 1}`} />
              </section>
            ))
            : proseSheets.map(({ chapter, opensChapter, blocks, key }) => (
              <section key={key} className="print-sheet">
                {opensChapter && (
                  <>
                    {numbers.get(chapter.id) && (
                      <p style={{ textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                        Chapter {numbers.get(chapter.id)}
                      </p>
                    )}
                    <h2 style={{ textAlign: 'center', fontSize: '1.6rem', fontWeight: 600, margin: '0.4rem 0 1.6rem' }}>
                      {chapter.title || 'Untitled'}
                    </h2>
                  </>
                )}
                <div className="book-page">
                  {blocks.length === 0
                    ? <p style={{ textAlign: 'center', fontStyle: 'italic', textIndent: 0 }}>This page is empty.</p>
                    : blocks.map((block, i) => <BlockView key={i} block={block} />)}
                </div>
              </section>
            ))}
        </div>,
        document.body,
      )}
    </>
  )
}
