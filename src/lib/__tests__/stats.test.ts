import { describe, expect, it } from 'vitest'
import { bookStats, countWords, formatCount, formatReadingTime, readingSummary } from '@/lib/stats'
import { createBook, createChapter } from '@/lib/book'

describe('countWords', () => {
  it('counts words, not whitespace', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('one')).toBe(1)
    expect(countWords('  one   two \n three ')).toBe(3)
  })
})

describe('bookStats', () => {
  it('totals words across chapters and counts only body chapters', () => {
    const book = createBook('Test')
    book.chapters = [
      createChapter('front', 'Preface', '<p>one two three</p>'),
      createChapter('chapter', 'One', '<p>four five</p>'),
      createChapter('chapter', 'Two', '<p>six</p>'),
    ]
    const stats = bookStats(book)
    expect(stats.words).toBe(6)
    expect(stats.chapters).toBe(2)
  })

  it('reports no reading time for an empty book', () => {
    const book = createBook('Empty')
    book.chapters = []
    expect(bookStats(book)).toMatchObject({ words: 0, chapters: 0, readingMinutes: 0 })
  })

  it('never rounds a non-empty book down to zero minutes', () => {
    const book = createBook('Short')
    book.chapters = [createChapter('chapter', 'One', '<p>a few words here</p>')]
    expect(bookStats(book).readingMinutes).toBe(1)
  })
})

describe('formatting', () => {
  it('groups thousands', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
  it('never says "about under a minute"', () => {
    expect(readingSummary(0)).toBe('under a minute of reading')
    expect(readingSummary(45)).toBe('about 45 min of reading')
  })
  it('reads reading time in human units', () => {
    expect(formatReadingTime(0)).toBe('under a minute')
    expect(formatReadingTime(45)).toBe('45 min')
    expect(formatReadingTime(60)).toBe('1 hr')
    expect(formatReadingTime(135)).toBe('2 hr 15 min')
  })
})
