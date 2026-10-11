import type { Book } from '@/types'
import { bookAuthor, bookTitle } from '@/lib/book'
import { paletteOf, type Palette } from '@/lib/cover'
import { loadImages } from '@/lib/graphic/assets'
import { BLEED_IN, MARKS_IN, trimOf, type TrimId } from '@/lib/graphic/render'

/**
 * The cover as a printer wants it: one flat sheet, back cover on the left,
 * spine in the middle, front cover on the right.
 *
 * A book is not finished when its pages are. A printer needs the jacket as a
 * single piece, the right width for the thickness of the paper inside it, with
 * the folds marked and the spine lettered. Working that width out by hand is
 * the part people get wrong — it depends on how many pages are in the book and
 * what it is printed on — so the app works it out.
 */

/** How thick one leaf of paper is, in inches. A leaf is two pages. */
export const PAPER_STOCKS = [
  { id: 'standard', label: 'Standard (60# offset)', leaf: 0.0045 },
  { id: 'thin', label: 'Thin (50# offset)', leaf: 0.0034 },
  { id: 'thick', label: 'Thick (70# or coated)', leaf: 0.0062 },
] as const

export type PaperStock = typeof PAPER_STOCKS[number]['id']

export function stockOf(id: PaperStock): typeof PAPER_STOCKS[number] {
  return PAPER_STOCKS.find((s) => s.id === id) ?? PAPER_STOCKS[0]
}

/**
 * How wide the spine has to be, in inches.
 *
 * Two pages to a leaf, so the thickness is half the page count times the
 * caliper of the paper. Under about an eighth of an inch a book is stapled
 * rather than bound and the spine carries no lettering — it is too narrow to
 * read and the words would wander onto the front.
 */
export const LETTERED_SPINE_IN = 0.125

export function spineInches(pageCount: number, stock: PaperStock = 'standard'): number {
  const pages = Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0
  return Math.ceil(pages / 2) * stockOf(stock).leaf
}

/**
 * How many pages the finished book has, which is what sets the spine width.
 * A graphic novel counts its drawn pages; a novel counts the pages of its
 * chapters.
 */
export function pageCountOf(book: Book): number {
  if (book.kind === 'graphic') return book.pages.length
  return book.chapters.reduce((total, chapter) => total + chapter.pages.length, 0)
}

export interface WrapBox {
  /** The whole sheet, in points. */
  width: number
  height: number
  /** Paper edge to trim line. */
  pad: number
  /** The finished jacket once it is cut. */
  trimWidth: number
  trimHeight: number
  /** One cover, and the spine between them. */
  coverWidth: number
  spineWidth: number
  /** Where each part starts, measured from the paper edge. */
  backX: number
  spineX: number
  frontX: number
  /** Where the artwork goes, running past the trim line when printing. */
  artX: number
  artY: number
  artWidth: number
  artHeight: number
}

/**
 * The arithmetic of the sheet, kept away from jsPDF so it can be checked on
 * its own. Two covers plus the spine across, one cover tall.
 */
export function wrapBox(
  trimId: TrimId, pageCount: number, stock: PaperStock = 'standard', printReady = true,
): WrapBox {
  const trim = trimOf(trimId)
  const pad = printReady ? (BLEED_IN + MARKS_IN) * 72 : 0
  const bleed = printReady ? BLEED_IN * 72 : 0
  const coverWidth = trim.width * 72
  const spineWidth = spineInches(pageCount, stock) * 72
  const trimWidth = coverWidth * 2 + spineWidth
  const trimHeight = trim.height * 72
  return {
    width: trimWidth + pad * 2,
    height: trimHeight + pad * 2,
    pad,
    trimWidth,
    trimHeight,
    coverWidth,
    spineWidth,
    backX: pad,
    spineX: pad + coverWidth,
    frontX: pad + coverWidth + spineWidth,
    artX: pad - bleed,
    artY: pad - bleed,
    artWidth: trimWidth + bleed * 2,
    artHeight: trimHeight + bleed * 2,
  }
}

/** Break text into lines that fit a width, at the current font. */
export function wrapLines(
  ctx: CanvasRenderingContext2D, text: string, maxWidth: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\n+/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/** Shrink the font until the text fits one line, and report the size used. */
function fitOneLine(
  ctx: CanvasRenderingContext2D, text: string, maxWidth: number,
  start: number, floor: number, font: (size: number) => string,
): number {
  let size = start
  ctx.font = font(size)
  while (ctx.measureText(text).width > maxWidth && size > floor) {
    size -= Math.max(1, start / 40)
    ctx.font = font(size)
  }
  return size
}

const DISPLAY = '"Comic Sans MS", system-ui, sans-serif'
const BODY = 'system-ui, sans-serif'

function coverArt(
  ctx: CanvasRenderingContext2D, art: HTMLImageElement,
  x: number, y: number, w: number, h: number, palette: Palette,
): void {
  const scale = Math.max(w / art.naturalWidth, h / art.naturalHeight)
  const aw = art.naturalWidth * scale
  const ah = art.naturalHeight * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(art, x + (w - aw) / 2, y + (h - ah) / 2, aw, ah)

  // The same scrim as the jacket on screen, so the printed title reads.
  const scrim = ctx.createLinearGradient(0, y, 0, y + h)
  scrim.addColorStop(0, `${palette.bg}f2`)
  scrim.addColorStop(0.22, `${palette.bg}b3`)
  scrim.addColorStop(0.45, `${palette.bg}26`)
  scrim.addColorStop(0.78, `${palette.bg}59`)
  scrim.addColorStop(1, `${palette.bg}ef`)
  ctx.fillStyle = scrim
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

export interface WrapRender {
  book: Book
  trim: TrimId
  pageCount: number
  stock: PaperStock
  dpi: number
  printReady: boolean
}

/**
 * Draw the whole jacket on one canvas.
 *
 * Laid out in the sheet's own coordinates — bleed included — so the result can
 * be dropped straight into the PDF at `artX`/`artY`.
 */
export async function renderWrap(opts: WrapRender): Promise<HTMLCanvasElement> {
  const { book, trim, pageCount, stock, dpi, printReady } = opts
  const box = wrapBox(trim, pageCount, stock, printReady)
  const px = dpi / 72

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(box.artWidth * px)
  canvas.height = Math.round(box.artHeight * px)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not draw the cover.')
  ctx.scale(px, px)

  // The canvas covers the artwork area, which starts a bleed outside the trim.
  const shift = box.pad - box.artX
  const palette = paletteOf(book.cover.palette)
  const images = book.cover.art ? await loadImages([book.cover.art]) : new Map()
  const art = book.cover.art ? images.get(book.cover.art) : undefined

  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, box.artWidth, box.artHeight)

  const top = shift
  const tall = box.trimHeight
  const back = { x: shift, w: box.coverWidth }
  const spine = { x: shift + box.coverWidth, w: box.spineWidth }
  const front = { x: shift + box.coverWidth + box.spineWidth, w: box.coverWidth }

  // ── Front ──────────────────────────────────────────────────────────────
  // Bleed only matters at the outside edges, so the front's artwork runs to
  // the right edge of the canvas and the back's to the left.
  if (art) {
    coverArt(ctx, art, front.x, 0, front.w + shift, box.artHeight, palette)
  }

  const scale = box.coverWidth / 1000
  const margin = box.coverWidth * 0.1
  const title = bookTitle(book).toUpperCase()
  const author = bookAuthor(book).toUpperCase()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const fx = front.x + front.w / 2

  ctx.fillStyle = palette.fg
  const titleSize = fitOneLine(
    ctx, title, front.w - margin * 2, 64 * scale, 20 * scale,
    (s) => `700 ${s}px ${DISPLAY}`,
  )
  ctx.font = `700 ${titleSize}px ${DISPLAY}`
  ctx.fillText(title, fx, top + tall * 0.38)

  if (book.subtitle.trim()) {
    ctx.fillStyle = palette.muted
    ctx.font = `italic ${26 * scale}px ${DISPLAY}`
    ctx.fillText(book.subtitle.trim(), fx, top + tall * 0.46)
  }

  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 4 * scale
  ctx.beginPath()
  ctx.moveTo(fx - 90 * scale, top + tall * 0.53)
  ctx.lineTo(fx + 90 * scale, top + tall * 0.53)
  ctx.stroke()

  ctx.fillStyle = palette.muted
  ctx.font = `${22 * scale}px ${BODY}`
  ctx.fillText(author, fx, top + tall * 0.6)

  // ── Spine ──────────────────────────────────────────────────────────────
  if (box.spineWidth > 0) {
    ctx.fillStyle = palette.bg
    ctx.fillRect(spine.x, 0, spine.w, box.artHeight)
    if (box.spineWidth >= LETTERED_SPINE_IN * 72) {
      // Read head-to-foot, which is how a book on a shelf is lettered.
      ctx.save()
      ctx.translate(spine.x + spine.w / 2, top + tall / 2)
      ctx.rotate(Math.PI / 2)
      ctx.fillStyle = palette.fg
      const spineSize = fitOneLine(
        ctx, `${title}   ${author}`, tall - margin, Math.min(box.spineWidth * 0.52, 22 * scale * 1.6),
        6, (s) => `700 ${s}px ${DISPLAY}`,
      )
      ctx.font = `700 ${spineSize}px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${title}   ${author}`, 0, 0)
      ctx.restore()
    }
  }

  // ── Back ───────────────────────────────────────────────────────────────
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, back.x + back.w, box.artHeight)

  const bx = back.x + back.w / 2
  const blurb = book.description.trim()

  ctx.textAlign = 'center'
  ctx.fillStyle = palette.muted
  ctx.font = `${18 * scale}px ${BODY}`
  ctx.fillText(title, bx, top + tall * 0.12)

  if (blurb) {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = palette.fg
    const bodySize = 22 * scale
    ctx.font = `${bodySize}px ${BODY}`
    const lines = wrapLines(ctx, blurb, back.w - margin * 2)
    const lineHeight = bodySize * 1.45
    let y = top + tall * 0.22
    for (const line of lines) {
      if (y + lineHeight > top + tall * 0.82) break
      ctx.fillText(line, back.x + margin, y)
      y += lineHeight
    }
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 2 * scale
  ctx.beginPath()
  ctx.moveTo(bx - 60 * scale, top + tall * 0.87)
  ctx.lineTo(bx + 60 * scale, top + tall * 0.87)
  ctx.stroke()

  ctx.fillStyle = palette.muted
  ctx.font = `${18 * scale}px ${BODY}`
  ctx.fillText(author, bx, top + tall * 0.92)

  return canvas
}
