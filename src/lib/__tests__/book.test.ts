import { describe, expect, it } from 'vitest'
import {
  chapterLabel, chapterNumbers, createBook, createChapter, duplicateBook, move, roman, slugify,
} from '@/lib/book'

describe('chapterNumbers', () => {
  it('numbers only body chapters, skipping front and back matter', () => {
    const chapters = [
      createChapter('front', 'Preface'),
      createChapter('chapter', 'One'),
      createChapter('chapter', 'Two'),
      createChapter('back', 'Appendix'),
    ]
    const numbers = chapterNumbers(chapters)
    expect(numbers.get(chapters[0].id)).toBeUndefined()
    expect(numbers.get(chapters[1].id)).toBe(1)
    expect(numbers.get(chapters[2].id)).toBe(2)
    expect(numbers.get(chapters[3].id)).toBeUndefined()
  })
})

describe('chapterLabel', () => {
  it('prefixes numbered chapters and leaves other matter alone', () => {
    expect(chapterLabel(createChapter('chapter', 'Wells'), 3)).toBe('3. Wells')
    expect(chapterLabel(createChapter('front', 'Preface'), undefined)).toBe('Preface')
  })
  it('falls back when a chapter has no title', () => {
    expect(chapterLabel(createChapter('front', ''), undefined)).toBe('Untitled')
  })
})

describe('roman', () => {
  it('converts the cases that actually differ', () => {
    expect([1, 4, 9, 14, 40, 90, 400, 1987].map(roman))
      .toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'CD', 'MCMLXXXVII'])
  })
})

describe('move', () => {
  it('reorders an item', () => {
    expect(move(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
  it('leaves the list alone for a no-op or an out-of-range index', () => {
    const list = ['a', 'b', 'c']
    expect(move(list, 1, 1)).toBe(list)
    expect(move(list, -1, 0)).toBe(list)
    expect(move(list, 0, 9)).toBe(list)
  })
})

describe('slugify', () => {
  it('makes a filename-safe name', () => {
    expect(slugify('The Salt Road')).toBe('the-salt-road')
    expect(slugify("A Writer's Tale!")).toBe('a-writers-tale')
    expect(slugify('  ---  ')).toBe('book')
    expect(slugify('')).toBe('book')
  })
})

describe('duplicateBook', () => {
  it('gives the copy fresh ids so it cannot overwrite the original', () => {
    const original = createBook('Original', 'Author')
    const copy = duplicateBook(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.title).toBe('Original (copy)')
    expect(copy.chapters).toHaveLength(original.chapters.length)
    expect(copy.chapters[0].id).not.toBe(original.chapters[0].id)
    expect(copy.chapters[0].pages[0].content).toBe(original.chapters[0].pages[0].content)
  })
})
