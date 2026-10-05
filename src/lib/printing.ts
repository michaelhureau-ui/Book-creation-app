import type { Block } from '@/lib/blocks'
import { parseBlocks } from '@/lib/blocks'
import type { Book, Chapter, Page } from '@/types'

/**
 * One sheet of paper. Deciding this apart from the component keeps the rule —
 * a page of the book is a page of the printout — testable, and keeps it the
 * same rule the PDF writer follows.
 */
export type PrintSheet =
  | { kind: 'title'; key: string }
  | { kind: 'prose'; key: string; chapter: Chapter; opensChapter: boolean; blocks: Block[] }
  | { kind: 'comic'; key: string; page: Page; index: number }

export function printSheets(book: Book): PrintSheet[] {
  const sheets: PrintSheet[] = [{ kind: 'title', key: 'title' }]

  if (book.kind === 'graphic') {
    book.pages.forEach((page, index) => sheets.push({ kind: 'comic', key: page.id, page, index }))
    return sheets
  }

  for (const chapter of book.chapters) {
    chapter.pages.forEach((page, index) => {
      sheets.push({
        kind: 'prose',
        key: page.id,
        chapter,
        opensChapter: index === 0,
        blocks: parseBlocks(page.content),
      })
    })
  }
  return sheets
}
