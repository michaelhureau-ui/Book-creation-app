import { describe, expect, it } from 'vitest'
import { bookFromJson, bookToJson } from '@/lib/export'
import { buildMarkdown } from '@/lib/export/markdown'
import { createBook, createChapter } from '@/lib/book'
import type { Book } from '@/types'

function sample(): Book {
  const book = createBook('The Salt Road', 'M. Hureau')
  book.subtitle = 'A crossing'
  book.chapters = [
    { ...createChapter('front', 'Preface'), content: '<p>Before we begin.</p>' },
    {
      ...createChapter('chapter', 'The Crossing'),
      content: '<p>Nobody spoke. <strong>Speaking cost water.</strong></p>'
        + '<blockquote><p>Salt is only patient water.</p></blockquote>'
        + '<ul><li><p>Rock salt</p></li><li><p>Nine camels</p></li></ul>'
        + '<ol><li><p>First</p></li></ol><hr>',
    },
  ]
  return book
}

describe('buildMarkdown', () => {
  const md = buildMarkdown(sample())

  it('opens with the title, subtitle and byline', () => {
    expect(md).toContain('# The Salt Road')
    expect(md).toContain('## A crossing')
    expect(md).toContain('*by M. Hureau*')
  })

  it('numbers body chapters but not front matter', () => {
    expect(md).toContain('## Preface')
    expect(md).toContain('## Chapter 1. The Crossing')
  })

  it('preserves inline and block formatting', () => {
    expect(md).toContain('**Speaking cost water')
    expect(md).toContain('> Salt is only patient water')
    expect(md).toContain('- Rock salt')
    expect(md).toContain('1. First')
    expect(md).toContain('---')
  })

  it('escapes markdown punctuation in prose', () => {
    const book = createBook('T')
    book.chapters = [{ ...createChapter('chapter', 'C'), content: '<p>A *star* and _score_.</p>' }]
    expect(buildMarkdown(book)).toContain('A \\*star\\* and \\_score\\_')
  })

  it('marks an empty chapter rather than emitting nothing', () => {
    const book = createBook('T')
    book.chapters = [createChapter('chapter', 'Blank')]
    expect(buildMarkdown(book)).toContain('*This chapter is empty.*')
  })
})

describe('JSON backup', () => {
  it('round-trips a book', async () => {
    const original = sample()
    const restored = bookFromJson(await bookToJson(original))
    expect(restored.title).toBe(original.title)
    expect(restored.subtitle).toBe(original.subtitle)
    expect(restored.chapters).toHaveLength(2)
    expect(restored.chapters[1].content).toBe(original.chapters[1].content)
    expect(restored.cover).toEqual(original.cover)
  })

  it('accepts a bare book object as well as a wrapped export', () => {
    const book = sample()
    expect(bookFromJson(JSON.stringify(book)).title).toBe('The Salt Road')
  })

  it('rejects files that are not books', () => {
    expect(() => bookFromJson('not json')).toThrow(/not valid JSON/)
    expect(() => bookFromJson('{"hello":1}')).toThrow(/does not look like/)
    expect(() => bookFromJson('{"title":"x"}')).toThrow(/does not look like/)
  })

  it('fills in missing fields rather than producing a broken book', () => {
    const restored = bookFromJson(JSON.stringify({
      title: 'Partial',
      chapters: [{ title: 'Only a title' }],
    }))
    expect(restored.author).toBe('')
    expect(restored.language).toBe('en')
    expect(restored.cover.palette).toBe('sepia')
    expect(restored.chapters[0]).toMatchObject({ kind: 'chapter', content: '' })
    expect(typeof restored.chapters[0].createdAt).toBe('number')
  })
})
