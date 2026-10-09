import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import type { Book, Page } from '@/types'
import { bookAuthor, bookTitle } from '@/lib/book'
import { paletteOf } from '@/lib/cover'
import { loadImages } from '@/lib/graphic/assets'
import { layoutOf } from '@/lib/graphic/layouts'
import {
  assetIdsOf, BLEED_IN, MARKS_IN, pageGeometry, renderPage, trimOf,
  type RenderOptions, type TrimId,
} from '@/lib/graphic/render'
import { BALLOON_LABELS } from '@/lib/graphic/pages'
import { DEFAULT_COMIC_OPTIONS, type ComicOptions } from '@/lib/export/comic-options'

export { DEFAULT_COMIC_OPTIONS }
export type { ComicOptions }

function renderOptions(opts: ComicOptions): RenderOptions {
  return { trim: opts.trim, dpi: opts.dpi, border: opts.borders ? undefined : 0 }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('A page could not be encoded.'))),
      type,
      quality,
    )
  })
}

/** The title page is drawn on the same canvas stack, so it matches the pages. */
function titleCanvas(book: Book, opts: ComicOptions): HTMLCanvasElement {
  const geo = pageGeometry(renderOptions(opts))
  const canvas = document.createElement('canvas')
  canvas.width = geo.width
  canvas.height = geo.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not render the title page.')
  const palette = paletteOf(book.cover.palette)
  const scale = geo.width / 1000

  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, geo.width, geo.height)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = geo.width / 2

  ctx.fillStyle = palette.fg
  ctx.font = `700 ${64 * scale}px "Comic Sans MS", system-ui, sans-serif`
  const title = bookTitle(book).toUpperCase()
  const maxW = geo.width - geo.margin * 2
  let size = 64 * scale
  while (ctx.measureText(title).width > maxW && size > 18 * scale) {
    size -= 2 * scale
    ctx.font = `700 ${size}px "Comic Sans MS", system-ui, sans-serif`
  }
  ctx.fillText(title, cx, geo.height * 0.38)

  if (book.subtitle.trim()) {
    ctx.fillStyle = palette.muted
    ctx.font = `italic ${26 * scale}px "Comic Sans MS", system-ui, sans-serif`
    ctx.fillText(book.subtitle.trim(), cx, geo.height * 0.46)
  }

  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 4 * scale
  ctx.beginPath()
  ctx.moveTo(cx - 90 * scale, geo.height * 0.53)
  ctx.lineTo(cx + 90 * scale, geo.height * 0.53)
  ctx.stroke()

  ctx.fillStyle = palette.muted
  ctx.font = `${22 * scale}px system-ui, sans-serif`
  ctx.fillText(bookAuthor(book).toUpperCase(), cx, geo.height * 0.6)
  return canvas
}

async function renderAll(book: Book, opts: ComicOptions): Promise<HTMLCanvasElement[]> {
  const images = await loadImages(assetIdsOf(book.pages))
  const render = renderOptions(opts)
  const canvases: HTMLCanvasElement[] = []
  if (opts.includeTitlePage) canvases.push(titleCanvas(book, opts))
  for (const page of book.pages) canvases.push(renderPage(page, images, render))
  return canvases
}

export interface ComicPageBox {
  /** The whole PDF page, in points. */
  width: number
  height: number
  /** The finished page once it has been cut. */
  trimWidth: number
  trimHeight: number
  /** Distance from the paper edge to the trim line. */
  pad: number
  /** Where the artwork goes, running past the trim line when printing. */
  artX: number
  artY: number
  artWidth: number
  artHeight: number
}

/**
 * How big the page is and where the artwork sits on it.
 *
 * Screen-ready: the page is the trim size and the artwork fills it. Print-ready:
 * the paper is larger, the artwork runs an eighth of an inch past where the cut
 * will be so no white edge can show, and the margin beyond that holds the crop
 * marks. Kept apart from jsPDF so the arithmetic can be checked on its own.
 */
export function comicPageBox(trimId: TrimId, printReady: boolean): ComicPageBox {
  const trim = trimOf(trimId)
  const pad = printReady ? (BLEED_IN + MARKS_IN) * 72 : 0
  const bleed = printReady ? BLEED_IN * 72 : 0
  const trimWidth = trim.width * 72
  const trimHeight = trim.height * 72
  return {
    width: trimWidth + pad * 2,
    height: trimHeight + pad * 2,
    trimWidth,
    trimHeight,
    pad,
    artX: pad - bleed,
    artY: pad - bleed,
    artWidth: trimWidth + bleed * 2,
    artHeight: trimHeight + bleed * 2,
  }
}

/**
 * The short lines outside each corner that tell a guillotine where the page
 * ends. They sit in the margin beyond the bleed, so they are cut away with it.
 */
function drawCropMarks(doc: jsPDF, pad: number, trimW: number, trimH: number): void {
  const length = MARKS_IN * 72 * 0.8
  const gap = BLEED_IN * 72
  doc.setDrawColor(0)
  doc.setLineWidth(0.4)
  const xs = [pad, pad + trimW]
  const ys = [pad, pad + trimH]
  for (const x of xs) {
    for (const y of ys) {
      const outX = x === pad ? -1 : 1
      const outY = y === pad ? -1 : 1
      // One mark along each edge, starting clear of the bleed.
      doc.line(x + outX * gap, y, x + outX * (gap + length), y)
      doc.line(x, y + outY * gap, x, y + outY * (gap + length))
    }
  }
}

/**
 * A comic page is artwork, so the PDF embeds each rendered page as an image
 * rather than trying to describe panels and lettering as vectors.
 */
export async function buildComicPdf(book: Book, partial: Partial<ComicOptions> = {}): Promise<Blob> {
  const opts = { ...DEFAULT_COMIC_OPTIONS, ...partial }
  const canvases = await renderAll(book, opts)
  if (canvases.length === 0) throw new Error('This graphic novel has no pages yet.')

  const box = comicPageBox(opts.trim, opts.printReady)
  const doc = new jsPDF({ unit: 'pt', format: [box.width, box.height], compress: true })

  canvases.forEach((canvas, i) => {
    if (i > 0) doc.addPage([box.width, box.height])
    doc.addImage(
      canvas.toDataURL('image/jpeg', 0.9), 'JPEG',
      box.artX, box.artY, box.artWidth, box.artHeight, undefined, 'FAST',
    )
    if (opts.printReady) drawCropMarks(doc, box.pad, box.trimWidth, box.trimHeight)
  })

  doc.setProperties({ title: bookTitle(book), author: bookAuthor(book) })
  return doc.output('blob')
}

/** CBZ is simply a zip of page images, named so readers sort them correctly. */
export async function buildCbz(book: Book, partial: Partial<ComicOptions> = {}): Promise<Blob> {
  const opts = { ...DEFAULT_COMIC_OPTIONS, ...partial }
  const canvases = await renderAll(book, opts)
  if (canvases.length === 0) throw new Error('This graphic novel has no pages yet.')

  const zip = new JSZip()
  for (const [i, canvas] of canvases.entries()) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9)
    zip.file(`${String(i + 1).padStart(3, '0')}.jpg`, blob)
  }
  zip.file('ComicInfo.xml', comicInfo(book))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.comicbook+zip' })
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The metadata sidecar most comic readers look for inside a CBZ. */
function comicInfo(book: Book): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${esc(bookTitle(book))}</Title>
  <Writer>${esc(bookAuthor(book))}</Writer>
  <Summary>${esc(book.description.trim())}</Summary>
  <PageCount>${book.pages.length}</PageCount>
  <LanguageISO>${esc(book.language || 'en')}</LanguageISO>
</ComicInfo>`
}

/**
 * A plain-text script in the shape letterers and collaborators expect: page,
 * panel, then each balloon in the order it was added.
 */
export function buildScript(book: Book): string {
  const lines: string[] = [
    bookTitle(book).toUpperCase(),
    book.subtitle.trim(),
    `by ${bookAuthor(book)}`,
    '',
    `${book.pages.length} ${book.pages.length === 1 ? 'page' : 'pages'}`,
    '',
  ].filter((l, i) => l !== '' || i > 2)

  let currentChapter: string | null | undefined
  book.pages.forEach((page: Page, pageIndex) => {
    // Pages are stored grouped by chapter, so a change of chapter is a heading.
    if (page.chapterId !== currentChapter) {
      currentChapter = page.chapterId
      const chapter = book.chapters.find((c) => c.id === page.chapterId)
      if (chapter) lines.push('', '', `CHAPTER: ${(chapter.title || 'Untitled').toUpperCase()}`)
    }
    lines.push('', '='.repeat(60), `PAGE ${pageIndex + 1}${page.title ? ` — ${page.title}` : ''}`,
      `Layout: ${layoutOf(page.layout).label} (${page.panels.length} ${page.panels.length === 1 ? 'panel' : 'panels'})`,
      '='.repeat(60))

    page.panels.forEach((panel, panelIndex) => {
      lines.push('', `PANEL ${pageIndex + 1}.${panelIndex + 1}`)
      const note = panel.note?.trim()
      lines.push(panel.assetId ? '  [artwork placed]' : '  [artwork to come]')
      // The brief is what a collaborator actually needs; the status line alone
      // tells them nothing about what to draw.
      if (note) lines.push(`  ART: ${note}`)
      if (panel.balloons.length === 0) {
        lines.push('  (no lettering)')
        return
      }
      for (const balloon of panel.balloons) {
        const label = BALLOON_LABELS[balloon.kind].toUpperCase()
        const who = balloon.speaker?.trim()
        const text = balloon.text.trim().replace(/\n/g, '\n      ')
        // A letterer needs to know who is speaking, not only what is said.
        lines.push(`  ${who ? `${label} (${who})` : label}: ${text}`)
      }
    })
  })

  return lines.join('\n') + '\n'
}
