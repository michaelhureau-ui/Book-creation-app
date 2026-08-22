import type { Book } from '@/types'
import { slugify } from '@/lib/book'
import type { PdfOptions } from '@/lib/export/pdf-options'

export type ExportFormat = 'pdf' | 'docx' | 'epub' | 'md' | 'json'

export const FORMAT_LABELS: Record<ExportFormat, { name: string; hint: string }> = {
  pdf: { name: 'PDF', hint: 'Typeset for print — title page, contents, running heads.' },
  docx: { name: 'Word', hint: 'An editable .docx with real heading styles.' },
  epub: { name: 'EPUB', hint: 'Reflowable e-book for Kindle, Apple Books, Kobo.' },
  md: { name: 'Markdown', hint: 'Plain text with formatting preserved.' },
  json: { name: 'Backup', hint: 'The full project file — re-importable into Bookwright.' },
}

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

export function bookToJson(book: Book): string {
  return JSON.stringify({ format: 'bookwright/v1', exportedAt: new Date().toISOString(), book }, null, 2)
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
  if (!book || typeof book !== 'object' || typeof book.title !== 'string' || !Array.isArray(book.chapters)) {
    throw new Error('That file does not look like a Bookwright backup.')
  }
  const now = Date.now()
  return {
    id: typeof book.id === 'string' ? book.id : '',
    title: book.title,
    subtitle: typeof book.subtitle === 'string' ? book.subtitle : '',
    author: typeof book.author === 'string' ? book.author : '',
    description: typeof book.description === 'string' ? book.description : '',
    language: typeof book.language === 'string' ? book.language : 'en',
    cover: {
      palette: book.cover?.palette ?? 'sepia',
      layout: book.cover?.layout ?? 'classic',
    },
    chapters: book.chapters.map((c, i) => ({
      id: typeof c?.id === 'string' ? c.id : `imported-${i}`,
      kind: c?.kind === 'front' || c?.kind === 'back' ? c.kind : 'chapter',
      title: typeof c?.title === 'string' ? c.title : `Chapter ${i + 1}`,
      content: typeof c?.content === 'string' ? c.content : '',
      createdAt: typeof c?.createdAt === 'number' ? c.createdAt : now,
      updatedAt: typeof c?.updatedAt === 'number' ? c.updatedAt : now,
    })),
    createdAt: typeof book.createdAt === 'number' ? book.createdAt : now,
    updatedAt: now,
  }
}

/**
 * Each writer is imported on demand. jsPDF and docx together outweigh the rest
 * of the app, and most sessions are spent writing rather than exporting.
 */
export async function exportBook(book: Book, format: ExportFormat, pdfOptions?: Partial<PdfOptions>): Promise<void> {
  const base = slugify(book.title)
  switch (format) {
    case 'pdf': {
      const { buildPdf } = await import('@/lib/export/pdf')
      downloadBlob(buildPdf(book, pdfOptions), `${base}.pdf`)
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
      downloadBlob(new Blob([bookToJson(book)], { type: 'application/json' }), `${base}.bookwright.json`)
  }
}
