import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createBook, createChapter } from '@/lib/book'
import { buildEpub } from '@/lib/export/epub'
import { buildPdf } from '@/lib/export/pdf'
import type { Book } from '@/types'

/** One chapter whose body is split across `count` pages. */
function split(count: number): Book {
  const book = createBook('Breaks', 'M. Hureau')
  const chapter = createChapter('chapter', 'One', '<p>The first sentence.</p>')
  for (let i = 1; i < count; i++) chapter.pages.push({ id: `p${i}`, content: `<p>Sentence ${i}.</p>` })
  book.chapters = [chapter]
  return book
}

async function chapterXhtml(book: Book): Promise<string> {
  const zip = await JSZip.loadAsync(await buildEpub(book))
  return zip.file('OEBPS/chapter-001.xhtml')!.async('string')
}

describe('a page the writer made', () => {
  it('starts a fresh sheet in the PDF', async () => {
    const pageCount = async (n: number): Promise<number> => {
      const zip = await buildPdf(split(n), { includeToc: false, includeTitlePage: false }).text()
      // jsPDF writes one /Type /Page object per sheet.
      return (zip.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    }
    // Three short pages would otherwise all fit on one sheet.
    expect(await pageCount(3)).toBe(3)
    expect(await pageCount(1)).toBe(1)
  })

  it('becomes a break hint in the EPUB', async () => {
    expect(await chapterXhtml(split(3))).toContain('class="page-break"')
    expect(await chapterXhtml(split(1))).not.toContain('class="page-break"')
  })

  it('leaves an empty chapter saying so once, not once per page', async () => {
    const book = createBook('Empty')
    book.chapters = [createChapter('chapter', 'One')]
    book.chapters[0].pages.push({ id: 'p2', content: '' })
    const xhtml = await chapterXhtml(book)
    expect(xhtml.match(/This chapter is empty/g)).toHaveLength(1)
  })
})
