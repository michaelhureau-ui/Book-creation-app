import type { Book, BookKind, Chapter, ChapterKind } from '@/types'

export function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  )
}

export function createChapter(kind: ChapterKind = 'chapter', title = 'Untitled chapter'): Chapter {
  const now = Date.now()
  return { id: newId(), kind, title, content: '', createdAt: now, updatedAt: now }
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
  return {
    ...book,
    id: newId(),
    title: `${book.title} (copy)`,
    chapters: book.chapters.map((c) => ({ ...c, id: newId() })),
    // Asset ids are remapped afterwards by the caller, which copies the
    // artwork rows: sharing them would let deleting one book strip the other.
    pages: book.pages.map((p) => ({
      ...p,
      id: newId(),
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
