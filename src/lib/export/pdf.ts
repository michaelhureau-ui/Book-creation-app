import { jsPDF } from 'jspdf'
import type { Block, Run } from '@/lib/blocks'
import { parseBlocks } from '@/lib/blocks'
import type { Book } from '@/types'
import { bookAuthor, bookTitle, chapterNumbers } from '@/lib/book'

import {
  DEFAULT_PDF_OPTIONS, TRIM, TRIM_LABELS, type PdfOptions, type TrimSize,
} from '@/lib/export/pdf-options'

export { DEFAULT_PDF_OPTIONS, TRIM_LABELS }
export type { PdfOptions, TrimSize }

const TOC_ENTRIES_PER_PAGE = 22

interface Piece {
  text: string
  run: Run
  width: number
  space: boolean
}

/**
 * jsPDF draws one font at a time, so mixed-format text has to be laid out by
 * hand: measure every word in its own style, greedily wrap into lines, then
 * draw the pieces left to right.
 */
class Typesetter {
  readonly doc: jsPDF
  readonly pageW: number
  readonly pageH: number
  readonly marginX: number
  readonly marginTop: number
  readonly marginBottom: number
  y: number
  /** Suppresses the running header/folio on chapter-opening pages. */
  private openerPages = new Set<number>()

  constructor(private readonly opts: PdfOptions) {
    const [w, h] = TRIM[opts.trim]
    // Justified text is drawn word by word, so a book runs to a lot of small
    // operators; stream compression keeps the file a sane size.
    this.doc = new jsPDF({ unit: 'pt', format: [w, h], compress: true })
    this.pageW = w
    this.pageH = h
    this.marginX = Math.round(w * 0.115)
    this.marginTop = Math.round(h * 0.095)
    this.marginBottom = Math.round(h * 0.105)
    this.y = this.marginTop
  }

  get textWidth(): number {
    return this.pageW - this.marginX * 2
  }

  get bottom(): number {
    return this.pageH - this.marginBottom
  }

  get page(): number {
    return this.doc.getNumberOfPages()
  }

  markOpener(): void {
    this.openerPages.add(this.page)
  }

  isOpener(page: number): boolean {
    return this.openerPages.has(page)
  }

  newPage(): void {
    this.doc.addPage()
    this.y = this.marginTop
  }

  /** Start a new page unless the current one is still blank. */
  ensureFreshPage(): void {
    if (this.y > this.marginTop) this.newPage()
  }

  needRoom(height: number): void {
    if (this.y + height > this.bottom) this.newPage()
  }

  setRunFont(run: Run, size: number): void {
    if (run.code) {
      this.doc.setFont('courier', run.bold ? 'bold' : 'normal')
    } else {
      const style = run.bold && run.italic ? 'bolditalic'
        : run.bold ? 'bold'
        : run.italic ? 'italic' : 'normal'
      this.doc.setFont('times', style)
    }
    this.doc.setFontSize(size)
  }

  private measure(text: string, run: Run, size: number): number {
    this.setRunFont(run, size)
    return this.doc.getTextWidth(text)
  }

  /** Break runs into lines that fit `maxWidth`. Explicit "\n" forces a break. */
  wrap(runs: Run[], size: number, maxWidth: number): Piece[][] {
    const lines: Piece[][] = []
    let line: Piece[] = []
    let used = 0

    const flush = (): void => { lines.push(line); line = []; used = 0 }

    for (const run of runs) {
      for (const token of run.text.split(/(\s+)/)) {
        if (!token) continue
        if (token.includes('\n')) { flush(); continue }
        const isSpace = /^\s+$/.test(token)
        // A line never opens with a space — that would ruin the left margin.
        if (isSpace && line.length === 0) continue
        const width = this.measure(token, run, size)
        if (used + width > maxWidth && line.length > 0) {
          // Trailing spaces are dropped rather than pushed to the next line.
          while (line.length && line[line.length - 1].space) { used -= line[line.length - 1].width; line.pop() }
          flush()
          if (isSpace) continue
        }
        line.push({ text: token, run, width, space: isSpace })
        used += width
      }
    }
    while (line.length && line[line.length - 1].space) line.pop()
    if (line.length) lines.push(line)
    return lines
  }

  /**
   * Draw one laid-out line. `justify` spreads leftover width across the spaces,
   * which is what gives body copy its even right edge.
   */
  drawLine(line: Piece[], x: number, size: number, maxWidth: number, justify: boolean): void {
    const spaces = line.filter((p) => p.space).length
    const used = line.reduce((sum, p) => sum + p.width, 0)
    const slack = maxWidth - used
    // Don't stretch a line that is mostly empty — it looks broken, not justified.
    const extra = justify && spaces > 0 && slack > 0 && slack < maxWidth * 0.28 ? slack / spaces : 0

    let cursor = x
    for (const piece of line) {
      const width = piece.width + (piece.space ? extra : 0)
      if (!piece.space) {
        this.setRunFont(piece.run, size)
        this.doc.text(piece.text, cursor, this.y)
        if (piece.run.underline) {
          this.doc.setLineWidth(0.5)
          this.doc.line(cursor, this.y + 1.5, cursor + piece.width, this.y + 1.5)
        }
        if (piece.run.strike) {
          this.doc.setLineWidth(0.5)
          this.doc.line(cursor, this.y - size * 0.28, cursor + piece.width, this.y - size * 0.28)
        }
      }
      cursor += width
    }
  }

  /** Lay out and draw a block of runs, paginating as needed. */
  paragraph(
    runs: Run[],
    opts: { size: number; leading: number; indent?: number; firstIndent?: number; justify?: boolean; align?: 'left' | 'center'; color?: [number, number, number]; spaceAfter?: number },
  ): void {
    const indent = opts.indent ?? 0
    const maxWidth = this.textWidth - indent
    const lines = this.wrap(runs, opts.size, maxWidth)
    const [r, g, b] = opts.color ?? [28, 26, 23]
    this.doc.setTextColor(r, g, b)

    lines.forEach((line, i) => {
      this.needRoom(opts.leading)
      this.y += opts.leading
      const first = i === 0 && opts.firstIndent ? opts.firstIndent : 0
      const isLast = i === lines.length - 1
      if (opts.align === 'center') {
        const used = line.reduce((sum, p) => sum + p.width, 0)
        this.drawLine(line, this.marginX + indent + (maxWidth - used) / 2, opts.size, maxWidth, false)
      } else {
        this.drawLine(line, this.marginX + indent + first, opts.size, maxWidth - first, !!opts.justify && !isLast)
      }
    })
    this.y += opts.spaceAfter ?? 0
  }

  /** Running headers and folios, added once the whole body is laid out. */
  finish(book: Book, headers: Map<number, string>, firstNumbered: number): void {
    const total = this.doc.getNumberOfPages()
    for (let p = 1; p <= total; p++) {
      if (p < firstNumbered) continue
      this.doc.setPage(p)
      this.doc.setFont('times', 'normal')
      this.doc.setFontSize(8.5)
      this.doc.setTextColor(139, 133, 124)

      // A chapter-opening page carries no running head — the chapter title is
      // already displayed on it — but it still gets a folio, as print does.
      if (!this.isOpener(p)) {
        const header = p % 2 === 0 ? bookTitle(book) : (headers.get(p) ?? bookTitle(book))
        this.doc.text(header.toUpperCase(), this.pageW / 2, this.marginTop - 14, {
          align: 'center',
          maxWidth: this.textWidth,
        })
      }
      if (this.opts.includePageNumbers) {
        this.doc.text(String(p), this.pageW / 2, this.pageH - this.marginBottom + 26, { align: 'center' })
      }
    }
  }
}

function tocPageCount(chapters: number): number {
  return Math.max(1, Math.ceil(chapters / TOC_ENTRIES_PER_PAGE))
}

function plainRun(text: string, marks: Partial<Run> = {}): Run[] {
  return [{ text, ...marks }]
}

/**
 * One rendering pass. `tocNumbers` is null on the first pass (page numbers are
 * not known yet) and filled on the second, which is why the pass runs twice.
 */
/** The jacket picture, ready for jsPDF: a data URL and the shape it came in. */
export interface CoverArt {
  dataUrl: string
  width: number
  height: number
}

function render(
  book: Book, opts: PdfOptions, tocNumbers: Map<string, number> | null, art?: CoverArt,
): { doc: jsPDF; starts: Map<string, number> } {
  const ts = new Typesetter(opts)
  const doc = ts.doc
  const numbers = chapterNumbers(book.chapters)
  const starts = new Map<string, number>()
  const headers = new Map<number, string>()
  const size = opts.fontSize
  const leading = size * 1.52

  // ── Cover ─────────────────────────────────────────────────────────────────
  // A picture on the jacket gets a page of its own at the front, filling the
  // sheet the way a printed cover does. The title page still follows it, since
  // the picture carries no lettering.
  if (art) {
    const scale = Math.max(ts.pageW / art.width, ts.pageH / art.height)
    const w = art.width * scale
    const h = art.height * scale
    doc.addImage(
      art.dataUrl, (ts.pageW - w) / 2, (ts.pageH - h) / 2, w, h, undefined, 'FAST',
    )
    doc.addPage()
    ts.y = ts.marginTop
  }

  // ── Title page ────────────────────────────────────────────────────────────
  if (opts.includeTitlePage) {
    ts.markOpener()
    ts.y = ts.pageH * 0.3
    ts.paragraph(plainRun(bookTitle(book), { bold: true }), { size: size * 2.4, leading: size * 2.7, align: 'center' })
    if (book.subtitle.trim()) {
      ts.y += 8
      ts.paragraph(plainRun(book.subtitle.trim(), { italic: true }), { size: size * 1.25, leading: size * 1.6, align: 'center', color: [74, 70, 64] })
    }
    ts.y += 40
    ts.paragraph(plainRun(bookAuthor(book)), { size: size * 1.05, leading: size * 1.4, align: 'center', color: [74, 70, 64] })
  }

  // ── Contents ──────────────────────────────────────────────────────────────
  if (opts.includeToc && book.chapters.length > 0) {
    ts.ensureFreshPage()
    ts.markOpener()
    const tocPages = tocPageCount(book.chapters.length)
    const tocFirstPage = ts.page
    ts.y = ts.marginTop + 30
    ts.paragraph(plainRun('Contents', { bold: true }), { size: size * 1.5, leading: size * 1.8, align: 'center', spaceAfter: 24 })

    book.chapters.forEach((chapter) => {
      const n = numbers.get(chapter.id)
      const label = n ? `${n}. ${chapter.title || 'Untitled'}` : chapter.title || 'Untitled'
      const pageNo = tocNumbers?.get(chapter.id)

      ts.needRoom(leading)
      ts.y += leading
      doc.setFont('times', 'normal')
      doc.setFontSize(size)
      doc.setTextColor(28, 26, 23)

      const right = ts.marginX + ts.textWidth
      const numText = pageNo ? String(pageNo) : ''
      const numWidth = numText ? doc.getTextWidth(numText) : 0
      const labelMax = ts.textWidth - numWidth - 18
      const shown = doc.splitTextToSize(label, labelMax)[0] as string
      const clipped = shown !== label ? shown.replace(/\s+\S*$/, '') + '…' : label
      doc.text(clipped, ts.marginX, ts.y)

      if (numText) {
        // Dot leaders between the title and its page number.
        const labelWidth = doc.getTextWidth(clipped)
        const gapStart = ts.marginX + labelWidth + 5
        const gapEnd = right - numWidth - 5
        if (gapEnd > gapStart) {
          doc.setTextColor(180, 174, 164)
          const dotWidth = doc.getTextWidth('.')
          const dots = '.'.repeat(Math.max(0, Math.floor((gapEnd - gapStart) / dotWidth)))
          if (dots) doc.text(dots, gapStart, ts.y)
          doc.setTextColor(28, 26, 23)
        }
        doc.text(numText, right, ts.y, { align: 'right' })
      }
    })

    // Keep the front matter a fixed length so both passes lay out identically.
    while (ts.page - tocFirstPage + 1 < tocPages) { ts.newPage(); ts.markOpener() }
  }

  const firstNumbered = ts.page + 1

  // ── Body ──────────────────────────────────────────────────────────────────
  for (const chapter of book.chapters) {
    ts.ensureFreshPage()
    ts.markOpener()
    starts.set(chapter.id, ts.page)
    ts.y = ts.marginTop + ts.pageH * 0.08

    const n = numbers.get(chapter.id)
    if (n) {
      ts.paragraph(plainRun(`CHAPTER ${n}`), { size: size * 0.78, leading: size * 1.1, align: 'center', color: [139, 133, 124], spaceAfter: 10 })
    }
    ts.paragraph(plainRun(chapter.title || 'Untitled', { bold: true }), { size: size * 1.7, leading: size * 2, align: 'center', spaceAfter: 26 })

    const written = chapter.pages.map((prosePage) => parseBlocks(prosePage.content))
    if (written.every((blocks) => blocks.length === 0)) {
      ts.paragraph(plainRun('This chapter is empty.', { italic: true }), { size, leading, align: 'center', color: [139, 133, 124] })
    }

    written.forEach((blocks, pageIndex) => {
      // The writer's own page breaks: every page after the first opens a fresh
      // sheet even when there is room left on the one before.
      if (pageIndex > 0) ts.ensureFreshPage()
      let previousWasText = false
      for (const block of blocks) {
        const pageBefore = ts.page
        drawBlock(ts, block, size, leading, previousWasText)
        previousWasText = block.type === 'paragraph'
        // Any page this chapter spills onto carries its title in the header.
        for (let p = pageBefore; p <= ts.page; p++) headers.set(p, chapter.title || bookTitle(book))
      }
    })
    for (let p = starts.get(chapter.id)!; p <= ts.page; p++) {
      if (!headers.has(p)) headers.set(p, chapter.title || bookTitle(book))
    }
  }

  ts.finish(book, headers, firstNumbered)
  return { doc, starts }
}

function drawBlock(ts: Typesetter, block: Block, size: number, leading: number, afterText: boolean): void {
  switch (block.type) {
    case 'heading': {
      const scale = block.level === 1 ? 1.35 : block.level === 2 ? 1.18 : 1.05
      ts.y += leading * 0.5
      ts.paragraph(block.runs.map((r) => ({ ...r, bold: true })), {
        size: size * scale, leading: size * scale * 1.4, spaceAfter: 6,
      })
      break
    }
    case 'quote':
      ts.y += leading * 0.35
      ts.paragraph(block.runs.map((r) => ({ ...r, italic: true })), {
        size: size * 0.96, leading: leading * 0.95, indent: 26, color: [74, 70, 64], spaceAfter: leading * 0.35,
      })
      break
    case 'code': {
      ts.y += leading * 0.3
      for (const line of block.text.split('\n')) {
        ts.paragraph(plainRun(line || ' ', { code: true }), { size: size * 0.86, leading: size * 1.25, indent: 18 })
      }
      ts.y += leading * 0.3
      break
    }
    case 'rule':
      ts.needRoom(leading * 2)
      ts.y += leading
      ts.paragraph(plainRun('* * *'), { size, leading, align: 'center', color: [139, 133, 124], spaceAfter: leading * 0.5 })
      break
    case 'list':
      block.items.forEach((item, i) => {
        const bullet = block.ordered ? `${i + 1}.` : '•'
        ts.needRoom(leading)
        ts.y += leading
        ts.setRunFont({ text: '' }, size)
        ts.doc.setTextColor(28, 26, 23)
        ts.doc.text(bullet, ts.marginX + 14, ts.y)
        // Step back so `paragraph` re-advances onto this same first line.
        ts.y -= leading
        ts.paragraph(item, { size, leading, indent: 34, spaceAfter: 2 })
      })
      ts.y += leading * 0.4
      break
    default:
      ts.paragraph(block.runs, {
        size,
        leading,
        justify: true,
        // Consecutive prose paragraphs get an indent instead of a blank line.
        firstIndent: afterText ? size * 1.3 : 0,
      })
  }
}

export function buildPdf(book: Book, options: Partial<PdfOptions> = {}, art?: CoverArt): Blob {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options }
  // Pass 1 discovers where each chapter lands; pass 2 prints those page numbers
  // into the table of contents. Front matter is a fixed length, so the two
  // passes produce identical body pagination.
  const first = render(book, opts, null, art)
  if (!opts.includeToc || book.chapters.length === 0) return first.doc.output('blob')
  return render(book, opts, first.starts, art).doc.output('blob')
}
