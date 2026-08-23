import { describe, expect, it } from 'vitest'
import {
  createBook, createChapter, duplicateBook, groupPages, normalizeBook, normalizeChapter,
  pageGroups, stepPage,
} from '@/lib/book'
import { createPage } from '@/lib/graphic/pages'
import { bookFromJson } from '@/lib/export'
import { buildMarkdown } from '@/lib/export/markdown'
import { buildScript } from '@/lib/export/comic'
import { bookStats, chapterText } from '@/lib/stats'
import type { Book, Chapter, Page } from '@/types'

function graphic(): Book {
  const book = createBook('Nightwing Hollow', 'M. Hureau', 'graphic')
  book.chapters = [createChapter('chapter', 'One'), createChapter('chapter', 'Two')]
  return book
}

/** Page ids are random, so tests read the book back as titles in order. */
function titles(pages: Page[]): string[] {
  return pages.map((p) => p.title)
}

describe('normalizeChapter', () => {
  it('folds a pre-pages chapter body into a first page', () => {
    const legacy = { ...createChapter('chapter', 'Old'), pages: [], content: '<p>Stored long ago.</p>' }
    const chapter = normalizeChapter(legacy as Chapter)
    expect(chapter.pages).toHaveLength(1)
    expect(chapter.pages[0].content).toBe('<p>Stored long ago.</p>')
    // The legacy field is read once and never written again.
    expect('content' in chapter).toBe(false)
  })

  it('gives a chapter with no pages at all one empty page', () => {
    const chapter = normalizeChapter({ ...createChapter('chapter', 'Blank'), pages: [] } as Chapter)
    expect(chapter.pages).toEqual([{ id: expect.any(String), content: '' }])
  })

  it('keeps pages that are already there', () => {
    const chapter = createChapter('chapter', 'Two pages', '<p>One.</p>')
    chapter.pages.push({ id: 'p2', content: '<p>Two.</p>' })
    expect(normalizeChapter(chapter).pages.map((p) => p.content))
      .toEqual(['<p>One.</p>', '<p>Two.</p>'])
  })
})

describe('groupPages', () => {
  const chapters = [createChapter('chapter', 'One'), createChapter('chapter', 'Two')]

  it('orders loose pages first, then each chapter in turn', () => {
    const pages = [
      createPage('splash', 'b', chapters[1].id),
      createPage('splash', 'a', chapters[0].id),
      createPage('splash', 'loose', null),
    ]
    expect(titles(groupPages(chapters, pages))).toEqual(['loose', 'a', 'b'])
  })

  it('keeps the order of pages that share a chapter', () => {
    const pages = [
      createPage('splash', 'first', chapters[0].id),
      createPage('splash', 'second', chapters[0].id),
      createPage('splash', 'third', chapters[0].id),
    ]
    expect(titles(groupPages(chapters, pages))).toEqual(['first', 'second', 'third'])
  })

  it('returns the very same array when nothing has to move', () => {
    const pages = [createPage('splash', 'a', chapters[0].id)]
    expect(groupPages(chapters, pages)).toBe(pages)
  })

  it('sets a page pointing at a deleted chapter loose rather than losing it', () => {
    const pages = [createPage('splash', 'orphan', 'gone'), createPage('splash', 'filed', chapters[0].id)]
    const grouped = groupPages(chapters, pages)
    expect(titles(grouped)).toEqual(['orphan', 'filed'])
    expect(grouped[0].chapterId).toBeNull()
  })
})

describe('pageGroups', () => {
  it('lists an empty chapter so there is somewhere to add its first page', () => {
    const book = graphic()
    book.pages = [createPage('splash', 'a', book.chapters[0].id)]
    expect(pageGroups(book).map((g) => [g.chapter?.title, g.pages.length]))
      .toEqual([['One', 1], ['Two', 0]])
  })

  it('counts only the drawn pages of a graphic novel', () => {
    const book = graphic()
    book.pages = [createPage('splash', 'a', book.chapters[0].id), createPage('splash', 'b', null)]
    // Its two chapters each carry an unused body page; neither is a comic page.
    expect(bookStats(book).pages).toBe(2)
  })

  it('drops the loose run when every page is filed', () => {
    const book = graphic()
    book.pages = [createPage('splash', 'a', book.chapters[0].id)]
    expect(pageGroups(book).some((g) => g.chapter === null)).toBe(false)
  })
})

describe('stepPage', () => {
  const chapters = [createChapter('chapter', 'One'), createChapter('chapter', 'Two')]
  const build = (): Page[] => groupPages(chapters, [
    createPage('splash', 'a', chapters[0].id),
    createPage('splash', 'b', chapters[0].id),
    createPage('splash', 'c', chapters[1].id),
  ])

  it('swaps two pages inside the same chapter', () => {
    const pages = build()
    expect(titles(stepPage(chapters, pages, pages[0].id, 1))).toEqual(['b', 'a', 'c'])
  })

  it('moves a page into the next chapter when it steps off the end of its own', () => {
    const pages = build()
    const moved = groupPages(chapters, stepPage(chapters, pages, pages[1].id, 1))
    expect(titles(moved)).toEqual(['a', 'b', 'c'])
    expect(moved.find((p) => p.title === 'b')?.chapterId).toBe(chapters[1].id)
  })

  it('moves a page back into the previous chapter when it steps off the front', () => {
    const pages = build()
    const moved = groupPages(chapters, stepPage(chapters, pages, pages[2].id, -1))
    expect(moved.find((p) => p.title === 'c')?.chapterId).toBe(chapters[0].id)
    expect(titles(moved)).toEqual(['a', 'b', 'c'])
  })

  it('files the only page of a book into an empty chapter, and back out again', () => {
    const loose = [createPage('splash', 'only', null)]
    const filed = stepPage(chapters, loose, loose[0].id, 1)
    expect(filed[0].chapterId).toBe(chapters[0].id)
    expect(stepPage(chapters, filed, filed[0].id, -1)[0].chapterId).toBeNull()
  })

  it('sets the first page of the book loose when it steps up out of chapter one', () => {
    const pages = build()
    expect(stepPage(chapters, pages, pages[0].id, -1)[0].chapterId).toBeNull()
  })

  it('does nothing once there is no chapter left to step into', () => {
    const pages = build()
    // 'c' is in the last chapter and last in the book: nowhere further to go.
    expect(stepPage(chapters, pages, pages[2].id, 1)).toBe(pages)
    const loose = [createPage('splash', 'only', null)]
    expect(stepPage(chapters, loose, loose[0].id, -1)).toBe(loose)
  })
})

describe('duplicateBook', () => {
  it('re-files the copied pages under the copied chapters', () => {
    const book = graphic()
    book.pages = [createPage('splash', 'a', book.chapters[0].id)]
    const copy = duplicateBook(book)
    expect(copy.pages[0].chapterId).toBe(copy.chapters[0].id)
    expect(copy.pages[0].chapterId).not.toBe(book.chapters[0].id)
  })

  it('gives every written page its own id', () => {
    const book = createBook('Prose')
    book.chapters[0].pages.push({ id: 'second', content: '<p>Two.</p>' })
    const copy = duplicateBook(book)
    expect(copy.chapters[0].pages.map((p) => p.id)).not.toContain('second')
    expect(copy.chapters[0].pages[1].content).toBe('<p>Two.</p>')
  })
})

describe('normalizeBook', () => {
  it('migrates chapters and regroups pages in one pass', () => {
    const book = graphic()
    book.chapters = book.chapters.map((c) => ({ ...c, pages: [], content: `<p>${c.title}</p>` }))
    book.pages = [
      createPage('splash', 'b', book.chapters[1].id),
      createPage('splash', 'a', book.chapters[0].id),
    ]
    const fixed = normalizeBook(book)
    expect(fixed.chapters[0].pages[0].content).toBe('<p>One</p>')
    expect(titles(fixed.pages)).toEqual(['a', 'b'])
  })
})

describe('backups', () => {
  it('reads a chapter written as pages', () => {
    const json = JSON.stringify({
      book: {
        title: 'Paged',
        chapters: [{ id: 'c1', title: 'One', pages: [{ id: 'p1', content: '<p>A.</p>' }, { id: 'p2', content: '<p>B.</p>' }] }],
        pages: [],
      },
    })
    expect(bookFromJson(json).chapters[0].pages.map((p) => p.content)).toEqual(['<p>A.</p>', '<p>B.</p>'])
  })

  it('still reads a chapter written before pages existed', () => {
    const json = JSON.stringify({ book: { title: 'Old', chapters: [{ title: 'One', content: '<p>hi</p>' }], pages: [] } })
    const restored = bookFromJson(json)
    expect(restored.chapters[0].pages).toEqual([{ id: expect.any(String), content: '<p>hi</p>' }])
  })

  it('keeps a graphic page filed under its chapter, and drops one that is not', () => {
    const json = JSON.stringify({
      book: {
        title: 'Comic',
        kind: 'graphic',
        chapters: [{ id: 'c1', title: 'One', pages: [] }],
        pages: [
          { id: 'p1', title: 'a', layout: 'splash', chapterId: 'c1', panels: [] },
          { id: 'p2', title: 'b', layout: 'splash', chapterId: 'nowhere', panels: [] },
        ],
      },
    })
    const restored = bookFromJson(json)
    // The loose page sorts ahead of the filed one, as it does everywhere else.
    expect(restored.pages.map((p) => [p.title, p.chapterId])).toEqual([['b', null], ['a', 'c1']])
  })
})

describe('written pages in exports and counts', () => {
  const chapter = createChapter('chapter', 'One', '<p>Page one words.</p>')
  chapter.pages.push({ id: 'p2', content: '<p>Page two words.</p>' })

  it('counts the words on every page of a chapter', () => {
    expect(chapterText(chapter)).toBe('Page one words.\n\nPage two words.')
    const book = createBook('Counted')
    book.chapters = [chapter]
    const stats = bookStats(book)
    expect(stats.words).toBe(6)
    expect(stats.pages).toBe(2)
  })

  it('runs the pages of a chapter together in Markdown, which has no page', () => {
    const book = createBook('Counted')
    book.chapters = [chapter]
    const md = buildMarkdown(book)
    expect(md).toContain('Page one words')
    expect(md).toContain('Page two words')
  })
})

describe('the comic script', () => {
  it('heads each run of pages with the chapter it belongs to', () => {
    const book = graphic()
    book.pages = groupPages(book.chapters, [
      createPage('splash', 'Opening', null),
      createPage('splash', 'Arrival', book.chapters[0].id),
      createPage('splash', 'Descent', book.chapters[1].id),
    ])
    const script = buildScript(book)
    expect(script).toContain('CHAPTER: ONE')
    expect(script).toContain('CHAPTER: TWO')
    // The loose page comes before either heading, and numbering runs on.
    expect(script.indexOf('PAGE 1 — Opening')).toBeLessThan(script.indexOf('CHAPTER: ONE'))
    expect(script.indexOf('CHAPTER: ONE')).toBeLessThan(script.indexOf('PAGE 2 — Arrival'))
    expect(script.indexOf('CHAPTER: TWO')).toBeLessThan(script.indexOf('PAGE 3 — Descent'))
    // A chapter is announced once, not before every page in it.
    expect(script.match(/CHAPTER: ONE/g)).toHaveLength(1)
  })

  it('says nothing about chapters in a book that has none', () => {
    const book = createBook('Loose', 'M. Hureau', 'graphic')
    book.pages = [createPage('splash', 'Opening', null)]
    expect(buildScript(book)).not.toContain('CHAPTER:')
  })
})
