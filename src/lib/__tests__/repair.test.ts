import { describe, expect, it } from 'vitest'
import { repairBook } from '@/lib/repair'
import { createBook, createChapter } from '@/lib/book'
import { createBalloon, createPage, createPanel } from '@/lib/graphic/pages'
import type { Book } from '@/types'

function comic(): Book {
  const book = createBook('The Ashfall Alliance', 'A. Hureau', 'graphic')
  const chapter = createChapter('chapter', 'One')
  const page = { ...createPage('two-rows'), chapterId: chapter.id }
  return { ...book, chapters: [chapter], pages: [page] }
}

describe('repairing a book', () => {
  it('says nothing is wrong with a book that is fine', () => {
    const { notes, book } = repairBook(comic())
    expect(notes).toEqual([])
    expect(book.pages).toHaveLength(1)
  })

  it('never throws away the writing', () => {
    const book = comic()
    const words = { ...createBalloon('speech'), text: 'Hold the line.' }
    book.pages[0].panels[0].balloons = [words]
    const { book: mended } = repairBook(book)
    expect(mended.pages[0].panels[0].balloons[0].text).toBe('Hold the line.')
  })

  it('brings a balloon that is off the edge back onto its panel', () => {
    const book = comic()
    book.pages[0].panels[0].balloons = [{ ...createBalloon('speech'), x: 4.2, y: -1 }]
    const { notes, book: mended } = repairBook(book)
    const fixed = mended.pages[0].panels[0].balloons[0]
    expect(fixed.x).toBeLessThanOrEqual(1)
    expect(fixed.y).toBeGreaterThanOrEqual(0)
    expect(notes.join(' ')).toMatch(/off the edge/)
  })

  it('rescues a balloon with no position at all', () => {
    const book = comic()
    book.pages[0].panels[0].balloons = [
      { ...createBalloon('speech'), x: Number.NaN, y: Number.NaN },
    ]
    const { notes, book: mended } = repairBook(book)
    const fixed = mended.pages[0].panels[0].balloons[0]
    expect(Number.isFinite(fixed.x)).toBe(true)
    expect(Number.isFinite(fixed.y)).toBe(true)
    expect(notes.join(' ')).toMatch(/no position/)
  })

  it('empties a panel pointing at artwork that is gone, so it can be drawn again', () => {
    const book = comic()
    book.pages[0].panels[0].assetId = 'asset-that-was-deleted'
    const { notes, book: mended } = repairBook(book, new Set(['something-else']))
    expect(mended.pages[0].panels[0].assetId).toBeNull()
    expect(notes.join(' ')).toMatch(/no longer there/)
  })

  it('leaves artwork that does exist alone', () => {
    const book = comic()
    book.pages[0].panels[0].assetId = 'real'
    const { notes, book: mended } = repairBook(book, new Set(['real']))
    expect(mended.pages[0].panels[0].assetId).toBe('real')
    expect(notes).toEqual([])
  })

  it('gives a page back to no chapter when its chapter is gone', () => {
    const book = comic()
    book.pages[0].chapterId = 'a-chapter-that-was-deleted'
    const { notes, book: mended } = repairBook(book)
    expect(mended.pages[0].chapterId).toBeNull()
    expect(notes.join(' ')).toMatch(/chapter that is gone/)
  })

  it('re-keys a page that shares an id with another', () => {
    const book = comic()
    book.pages = [book.pages[0], { ...book.pages[0] }]
    const { notes, book: mended } = repairBook(book)
    expect(mended.pages[0].id).not.toBe(mended.pages[1].id)
    expect(notes.join(' ')).toMatch(/repeated id/)
  })

  it('widens a page whose layout cannot show all its panels', () => {
    const book = comic()
    // Four panels on a two-row page: two of them were invisible.
    book.pages[0].panels = [createPanel(), createPanel(), createPanel(), createPanel()]
    const { notes, book: mended } = repairBook(book)
    expect(mended.pages[0].panels).toHaveLength(4)
    expect(mended.pages[0].layout).toBe('four-grid')
    expect(notes.join(' ')).toMatch(/more panels than/)
  })

  it('counts a fault that happened many times, rather than listing it over and over', () => {
    const book = comic()
    book.pages[0].panels[0].balloons = [
      { ...createBalloon('speech'), x: 9 },
      { ...createBalloon('speech'), x: 9 },
      { ...createBalloon('speech'), x: 9 },
    ]
    const { notes } = repairBook(book)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/3 of them/)
  })

  it('keeps a blank page in a chapter that has none, so it can still be typed in', () => {
    const book = createBook('Prose', '', 'prose')
    const empty = { ...createChapter('chapter', 'One'), pages: [] }
    const { book: mended } = repairBook({ ...book, chapters: [empty] })
    expect(mended.chapters[0].pages).toHaveLength(1)
  })
})
