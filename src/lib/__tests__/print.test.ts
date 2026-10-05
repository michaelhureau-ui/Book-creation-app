import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { printSheets } from '@/lib/printing'
import { createBook, createChapter, createProsePage } from '@/lib/book'
import { createPage } from '@/lib/graphic/pages'
import type { Book } from '@/types'

function novel(): Book {
  const book = createBook('Deep Water', 'M. Hureau')
  const one = createChapter('chapter', 'One', '<p>First page.</p>')
  one.pages.push(createProsePage('<p>Second page.</p>'))
  const two = createChapter('chapter', 'Two', '<p>Only page.</p>')
  book.chapters = [one, two]
  return book
}

describe('what goes on each sheet of paper', () => {
  it('gives every written page its own sheet, after the title page', () => {
    const sheets = printSheets(novel())
    expect(sheets.map((s) => s.kind)).toEqual(['title', 'prose', 'prose', 'prose'])
    expect(sheets).toHaveLength(4)
  })

  it('opens a chapter only on its first sheet', () => {
    const sheets = printSheets(novel()).filter((s) => s.kind === 'prose')
    expect(sheets.map((s) => s.opensChapter)).toEqual([true, false, true])
  })

  it('gives every drawn page its own sheet', () => {
    const book = createBook('Comic', '', 'graphic')
    book.pages = [createPage('splash', 'a', null), createPage('four-grid', 'b', null)]
    expect(printSheets(book).map((s) => s.kind)).toEqual(['title', 'comic', 'comic'])
  })

  it('still prints a title page for a book with nothing in it', () => {
    const empty = createBook('Nothing', '', 'graphic')
    expect(printSheets(empty).map((s) => s.kind)).toEqual(['title'])
  })
})

describe('the print stylesheet', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

  /**
   * Without a break after each sheet the whole book runs together as one long
   * page, and without hiding the app the printer gets the editor's chrome too.
   */
  it('breaks the paper between sheets and hides the app itself', () => {
    const print = css.slice(css.indexOf('@media print'))
    expect(print).toMatch(/\.app-root\s*\{\s*display:\s*none/)
    expect(print).toMatch(/\.print-root\s*\{\s*display:\s*block/)
    expect(print).toContain('page-break-after: always')
    // The last sheet must not push out a blank one.
    expect(print).toMatch(/:last-child\s*\{[^}]*page-break-after:\s*auto/)
  })

  it('keeps a comic page whole rather than split across two sheets', () => {
    expect(css.slice(css.indexOf('@media print'))).toContain('break-inside: avoid')
  })
})
