import type { Book } from '@/types'
import { normalizeBook, slugify } from '@/lib/book'
import type { PdfOptions } from '@/lib/export/pdf-options'
import type { ComicOptions } from '@/lib/export/comic-options'
import { exportAssets, importAssets } from '@/lib/graphic/assets'
import type { Balloon, BalloonKind, Page, PageLayoutId, Panel } from '@/types'
import { panelCount } from '@/lib/graphic/layouts'

export type ExportFormat =
  'pdf' | 'docx' | 'epub' | 'md' | 'json' | 'cbz' | 'script' | 'cover'

export const FORMAT_LABELS: Record<ExportFormat, { name: string; hint: string }> = {
  pdf: { name: 'PDF', hint: 'Typeset for print — title page, contents, running heads.' },
  docx: { name: 'Word', hint: 'An editable .docx with real heading styles.' },
  epub: { name: 'EPUB', hint: 'Reflowable e-book for Kindle, Apple Books, Kobo.' },
  md: { name: 'Markdown', hint: 'Plain text with formatting preserved.' },
  json: { name: 'Backup', hint: 'The full project file — re-importable into Bookwright.' },
  cbz: { name: 'CBZ', hint: 'Comic archive of page images, for any comic reader.' },
  script: { name: 'Script', hint: 'The lettering as a plain-text shooting script.' },
  cover: {
    name: 'Printable cover',
    hint: 'Back cover, spine and front on one flat sheet, with the folds marked.',
  },
}

/** Which formats make sense for each kind of book. */
export const PROSE_FORMATS: ExportFormat[] = ['pdf', 'cover', 'docx', 'epub', 'md', 'json']
export const GRAPHIC_FORMATS: ExportFormat[] = ['pdf', 'cover', 'cbz', 'script', 'json']

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * A backup of a graphic novel embeds its artwork as base64 — otherwise the
 * file would reference panels that only exist in the browser it came from.
 */
export async function bookToJson(book: Book): Promise<string> {
  const assets = book.kind === 'graphic' ? await exportAssets(book.id) : undefined
  return JSON.stringify(
    { format: 'bookwright/v2', exportedAt: new Date().toISOString(), book, assets },
    null,
    2,
  )
}

function readBalloon(raw: Partial<Balloon> | undefined, i: number): Balloon {
  const kinds: BalloonKind[] = ['speech', 'thought', 'caption', 'shout', 'sfx']
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return {
    id: typeof raw?.id === 'string' ? raw.id : `balloon-${i}`,
    kind: kinds.includes(raw?.kind as BalloonKind) ? (raw!.kind as BalloonKind) : 'speech',
    text: typeof raw?.text === 'string' ? raw.text : '',
    speaker: typeof raw?.speaker === 'string' ? raw.speaker : undefined,
    x: num(raw?.x, 0.5),
    y: num(raw?.y, 0.25),
    width: num(raw?.width, 0.4),
    tailX: num(raw?.tailX, 0.5),
    tailY: num(raw?.tailY, 0.7),
  }
}

function readPage(raw: Partial<Page> | undefined, i: number): Page {
  const layouts: PageLayoutId[] = [
    'splash', 'two-rows', 'three-rows', 'three-columns', 'four-grid', 'six-grid', 'hero-two', 'two-hero',
  ]
  const layout = layouts.includes(raw?.layout as PageLayoutId) ? (raw!.layout as PageLayoutId) : 'four-grid'
  const panels: Panel[] = (Array.isArray(raw?.panels) ? raw!.panels : []).map((p, pi) => ({
    id: typeof p?.id === 'string' ? p.id : `panel-${i}-${pi}`,
    assetId: typeof p?.assetId === 'string' ? p.assetId : null,
    note: typeof p?.note === 'string' ? p.note : undefined,
    zoom: typeof p?.zoom === 'number' && p.zoom >= 1 ? p.zoom : 1,
    offsetX: typeof p?.offsetX === 'number' ? p.offsetX : 0,
    offsetY: typeof p?.offsetY === 'number' ? p.offsetY : 0,
    balloons: (Array.isArray(p?.balloons) ? p.balloons : []).map(readBalloon),
  }))
  // The layout decides how many panels a page has; trust it over the array.
  const wanted = panelCount(layout)
  while (panels.length < wanted) {
    panels.push({ id: `panel-${i}-${panels.length}`, assetId: null, zoom: 1, offsetX: 0, offsetY: 0, balloons: [] })
  }
  return {
    id: typeof raw?.id === 'string' ? raw.id : `page-${i}`,
    title: typeof raw?.title === 'string' ? raw.title : `Page ${i + 1}`,
    layout,
    // A chapter id that names nothing is dropped when the book is normalised.
    chapterId: typeof raw?.chapterId === 'string' ? raw.chapterId : null,
    panels: panels.slice(0, wanted),
  }
}

/** Validate an imported file, since it may be hand-edited or from another app. */
export function bookFromJson(text: string): Book {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const candidate = (parsed as { book?: unknown }).book ?? parsed
  const book = candidate as Partial<Book>
  if (!book || typeof book !== 'object' || typeof book.title !== 'string') {
    throw new Error('That file does not look like a Bookwright backup.')
  }
  const chapters = Array.isArray(book.chapters) ? book.chapters : []
  const pages = Array.isArray(book.pages) ? book.pages : []
  if (chapters.length === 0 && pages.length === 0 && !Array.isArray(book.chapters)) {
    throw new Error('That file does not look like a Bookwright backup.')
  }
  const now = Date.now()
  return normalizeBook({
    id: typeof book.id === 'string' ? book.id : '',
    kind: book.kind === 'graphic' ? 'graphic' : 'prose',
    title: book.title,
    subtitle: typeof book.subtitle === 'string' ? book.subtitle : '',
    author: typeof book.author === 'string' ? book.author : '',
    description: typeof book.description === 'string' ? book.description : '',
    language: typeof book.language === 'string' ? book.language : 'en',
    cover: {
      palette: book.cover?.palette ?? 'sepia',
      layout: book.cover?.layout ?? 'classic',
    },
    chapters: chapters.map((c, i) => ({
      id: typeof c?.id === 'string' ? c.id : `imported-${i}`,
      kind: c?.kind === 'front' || c?.kind === 'back' ? c.kind : 'chapter',
      title: typeof c?.title === 'string' ? c.title : `Chapter ${i + 1}`,
      // Both shapes are accepted: pages, or the single body older files carry.
      pages: (Array.isArray(c?.pages) ? c.pages : [])
        .filter((page) => typeof page?.content === 'string')
        .map((page, pi) => ({
          id: typeof page?.id === 'string' ? page.id : `imported-${i}-${pi}`,
          content: page.content as string,
        })),
      content: typeof c?.content === 'string' ? c.content : '',
      createdAt: typeof c?.createdAt === 'number' ? c.createdAt : now,
      updatedAt: typeof c?.updatedAt === 'number' ? c.updatedAt : now,
    })),
    pages: pages.map(readPage),
    createdAt: typeof book.createdAt === 'number' ? book.createdAt : now,
    updatedAt: now,
  })
}

/** Artwork carried in a backup file, restored under the new book's id. */
export async function restoreAssets(text: string, bookId: string): Promise<void> {
  try {
    const parsed = JSON.parse(text) as { assets?: Record<string, { type?: string; width?: number; height?: number; data?: string }> }
    await importAssets(bookId, parsed.assets)
  } catch { /* a backup without artwork is still a valid import */ }
}

/**
 * Each writer is imported on demand. jsPDF and docx together outweigh the rest
 * of the app, and most sessions are spent writing rather than exporting.
 */
/**
 * The jacket picture as something jsPDF can place.
 *
 * Read straight out of the database rather than from a screen element, so an
 * export is the same whether the cover has been looked at or not.
 */
async function coverArtFor(book: Book): Promise<{ dataUrl: string; width: number; height: number } | undefined> {
  if (!book.cover.art) return undefined
  const { loadAsset } = await import('@/lib/db')
  const asset = await loadAsset(book.cover.art)
  if (!asset) return undefined
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The cover picture could not be read.'))
    reader.readAsDataURL(asset.blob)
  })
  return { dataUrl, width: asset.width || 1024, height: asset.height || 1536 }
}

export async function exportBook(
  book: Book,
  format: ExportFormat,
  options?: { pdf?: Partial<PdfOptions>; comic?: Partial<ComicOptions> },
): Promise<void> {
  const base = slugify(book.title)
  switch (format) {
    case 'pdf': {
      if (book.kind === 'graphic') {
        const { buildComicPdf } = await import('@/lib/export/comic')
        downloadBlob(await buildComicPdf(book, options?.comic), `${base}.pdf`)
        return
      }
      const { buildPdf } = await import('@/lib/export/pdf')
      downloadBlob(buildPdf(book, options?.pdf, await coverArtFor(book)), `${base}.pdf`)
      return
    }
    case 'cover': {
      const { buildCoverWrapPdf } = await import('@/lib/export/comic')
      downloadBlob(await buildCoverWrapPdf(book, options?.comic), `${base}-cover.pdf`)
      return
    }
    case 'cbz': {
      const { buildCbz } = await import('@/lib/export/comic')
      downloadBlob(await buildCbz(book, options?.comic), `${base}.cbz`)
      return
    }
    case 'script': {
      const { buildScript } = await import('@/lib/export/comic')
      downloadBlob(new Blob([buildScript(book)], { type: 'text/plain;charset=utf-8' }), `${base}-script.txt`)
      return
    }
    case 'docx': {
      const { buildDocx } = await import('@/lib/export/docx')
      downloadBlob(await buildDocx(book), `${base}.docx`)
      return
    }
    case 'epub': {
      const { buildEpub } = await import('@/lib/export/epub')
      downloadBlob(await buildEpub(book), `${base}.epub`)
      return
    }
    case 'md': {
      const { buildMarkdown } = await import('@/lib/export/markdown')
      downloadBlob(new Blob([buildMarkdown(book)], { type: 'text/markdown;charset=utf-8' }), `${base}.md`)
      return
    }
    case 'json':
      downloadBlob(new Blob([await bookToJson(book)], { type: 'application/json' }), `${base}.bookwright.json`)
  }
}
