import type { Book, BookKind, Chapter, ChapterKind, Page, ProsePage } from '@/types'
import { aimBalloons } from '@/lib/graphic/lettering'

export function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  )
}

export function createProsePage(content = ''): ProsePage {
  return { id: newId(), content }
}

export function createChapter(
  kind: ChapterKind = 'chapter',
  title = 'Untitled chapter',
  content = '',
): Chapter {
  const now = Date.now()
  return { id: newId(), kind, title, pages: [createProsePage(content)], createdAt: now, updatedAt: now }
}

/**
 * A chapter written before pages existed carries its whole body in `content`.
 * Fold it into a first page, and guarantee the "at least one page" rule that
 * the editor, the exporters, and the page strip all rely on.
 */
export function normalizeChapter(chapter: Chapter): Chapter {
  const { content, ...rest } = chapter
  const pages = (Array.isArray(chapter.pages) ? chapter.pages : [])
    .filter((page): page is ProsePage => !!page && typeof page.content === 'string')
    .map((page) => ({ id: typeof page.id === 'string' && page.id ? page.id : newId(), content: page.content }))
  if (pages.length === 0) pages.push(createProsePage(typeof content === 'string' ? content : ''))
  return { ...rest, pages }
}

/**
 * Pages are stored in reading order, grouped by chapter. Loose pages come
 * first — they are the ones that existed before any chapter was added — then
 * each chapter's pages in the chapters' own order. A stable sort means a page
 * already in the right group never moves.
 */
export function groupPages(chapters: Chapter[], pages: Page[]): Page[] {
  const rank = new Map<string, number>()
  chapters.forEach((chapter, i) => rank.set(chapter.id, i))
  // A page pointing at a deleted chapter is loose again, not lost.
  const cleaned = pages.map((page) =>
    page.chapterId && rank.has(page.chapterId) ? page : { ...page, chapterId: null })
  const rankOf = (page: Page): number => (page.chapterId ? rank.get(page.chapterId)! : -1)
  const sorted = cleaned
    .map((page, i) => ({ page, i }))
    .sort((a, b) => rankOf(a.page) - rankOf(b.page) || a.i - b.i)
    .map((entry) => entry.page)
  // Returning the original array when nothing moved keeps React renders cheap.
  return sorted.every((page, i) => page === pages[i]) ? pages : sorted
}

/**
 * Nudge one page a single step through the book. Within a chapter the two
 * pages swap; at a chapter's edge the page changes chapter instead, which is
 * what "down" from the last page of chapter one has to mean. At the very ends
 * of the book the step is into the neighbouring chapter, so a page can still
 * be filed into an empty one — or set loose again. Returns the pages unchanged
 * when there is nowhere left to go.
 */
export function stepPage(chapters: Chapter[], pages: Page[], pageId: string, delta: -1 | 1): Page[] {
  const from = pages.findIndex((p) => p.id === pageId)
  if (from === -1) return pages
  const to = from + delta
  const refile = (chapterId: string | null): Page[] =>
    pages.map((p) => (p.id === pageId ? { ...p, chapterId } : p))

  if (to >= 0 && to < pages.length) {
    if (pages[to].chapterId === pages[from].chapterId) return move(pages, from, to)
    // Re-filing is the whole move: grouping puts the page at the near end of
    // the chapter it just joined, which is the position one step away.
    return refile(pages[to].chapterId)
  }

  // Off the end of the book: the next chapter heading is the next stop. Loose
  // pages sit before every chapter, which makes them rank -1.
  const current = pages[from].chapterId
  const rank = current ? chapters.findIndex((c) => c.id === current) : -1
  const next = rank + delta
  if (next < -1 || next > chapters.length - 1) return pages
  return refile(next === -1 ? null : chapters[next].id)
}

/** The pages of a graphic novel split into the runs the page list draws. */
export function pageGroups(book: Book): { chapter: Chapter | null; pages: Page[] }[] {
  const groups: { chapter: Chapter | null; pages: Page[] }[] = [
    { chapter: null, pages: book.pages.filter((p) => !p.chapterId) },
    ...book.chapters.map((chapter) => ({
      chapter,
      pages: book.pages.filter((p) => p.chapterId === chapter.id),
    })),
  ]
  // An empty "loose pages" run is noise; an empty chapter still needs its row
  // so there is somewhere to add the first page.
  return groups.filter((g) => g.chapter !== null || g.pages.length > 0)
}

/** Every chapter migrated, and every page filed where its chapter says it is. */
export function normalizeBook(book: Book): Book {
  const chapters = book.chapters.map(normalizeChapter)
  const pages = groupPages(chapters, book.pages.map((page) => ({
    ...page,
    chapterId: typeof page.chapterId === 'string' ? page.chapterId : null,
    // Opening a book is when its lettering is tidied: every tail aimed at
    // whoever is speaking, and the sound effects moved out of the picture.
    // Balloons placed by hand are left alone.
    panels: page.panels.map((panel) => ({ ...panel, balloons: aimBalloons(panel.balloons) })),
  })))
  return { ...book, chapters, pages }
}

export function createBook(title = 'Untitled book', author = '', kind: BookKind = 'prose'): Book {
  const now = Date.now()
  return {
    id: newId(),
    kind,
    title,
    subtitle: '',
    author,
    description: '',
    language: 'en',
    cover: { palette: kind === 'graphic' ? 'ember' : 'sepia', layout: 'classic' },
    chapters: kind === 'prose' ? [createChapter('chapter', 'Chapter One')] : [],
    pages: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** A duplicate is a fresh book — new ids throughout, so the two never collide in storage. */
export function duplicateBook(book: Book): Book {
  const now = Date.now()
  // Pages point at chapters by id, so the copy has to follow the rename.
  const chapterIds = new Map(book.chapters.map((c) => [c.id, newId()]))
  return {
    ...book,
    id: newId(),
    title: `${book.title} (copy)`,
    chapters: book.chapters.map((c) => ({
      ...c,
      id: chapterIds.get(c.id)!,
      pages: c.pages.map((page) => ({ ...page, id: newId() })),
    })),
    // Asset ids are remapped afterwards by the caller, which copies the
    // artwork rows: sharing them would let deleting one book strip the other.
    pages: book.pages.map((p) => ({
      ...p,
      id: newId(),
      chapterId: p.chapterId ? chapterIds.get(p.chapterId) ?? null : null,
      panels: p.panels.map((panel) => ({
        ...panel,
        id: newId(),
        balloons: panel.balloons.map((b) => ({ ...b, id: newId() })),
      })),
    })),
    createdAt: now,
    updatedAt: now,
  }
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

export function roman(n: number): string {
  let rest = n
  let out = ''
  for (const [value, sym] of ROMAN) {
    while (rest >= value) { out += sym; rest -= value }
  }
  return out
}

/**
 * Only `kind: 'chapter'` entries are numbered. Front matter (a preface) and
 * back matter (an appendix) keep their own titles, matching print convention.
 */
export function chapterNumbers(chapters: Chapter[]): Map<string, number> {
  const map = new Map<string, number>()
  let n = 0
  for (const c of chapters) {
    if (c.kind === 'chapter') map.set(c.id, ++n)
  }
  return map
}

export function chapterLabel(chapter: Chapter, number: number | undefined): string {
  if (chapter.kind !== 'chapter' || !number) return chapter.title || 'Untitled'
  return `${number}. ${chapter.title || 'Untitled'}`
}

export function bookTitle(book: Book): string {
  return book.title.trim() || 'Untitled book'
}

export function bookAuthor(book: Book): string {
  return book.author.trim() || 'Anonymous'
}

/** Filename-safe slug for downloads. */
export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'book'
}

export function move<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
