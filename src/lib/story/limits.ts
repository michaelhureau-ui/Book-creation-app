/**
 * Mirrors the limits the story endpoint enforces, so the form can stop someone
 * before a round trip. The endpoint has to be self-contained to deploy, so the
 * values are duplicated rather than imported — a unit test holds them equal.
 */
export const MAX_IDEA_LENGTH = 1200

export const MAX_SHOW_LENGTH = 120

export const STORY_LENGTHS = ['short', 'medium', 'long'] as const

export const STORY_AUDIENCES = ['children', 'middle', 'teen', 'adult'] as const

/**
 * How many chapters each book is meant to have, and how many pages each of
 * those chapters runs to, mirroring the endpoint's SHAPES.
 *
 * The app needs the chapter count to tell a short plan from the book that was
 * asked for — a plan with one chapter in it is a five-page book, and that used
 * to happen without a word being said. It needs the page count to say on the
 * button what you are about to get.
 */
export type ShapeKind = 'prose' | 'graphic' | 'picture'

export const SHAPES: Record<ShapeKind, Record<'short' | 'medium' | 'long', {
  chapters: number
  pages: number
}>> = {
  prose: {
    short: { chapters: 10, pages: 5 },
    medium: { chapters: 20, pages: 5 },
    long: { chapters: 40, pages: 5 },
  },
  graphic: {
    short: { chapters: 6, pages: 4 },
    medium: { chapters: 16, pages: 4 },
    long: { chapters: 24, pages: 5 },
  },
  picture: {
    short: { chapters: 6, pages: 4 },
    medium: { chapters: 8, pages: 4 },
    long: { chapters: 12, pages: 4 },
  },
}

/**
 * How many pages a chapter runs to when the length was given as a page count
 * rather than chosen by name.
 */
export const PER_CHAPTER: Record<ShapeKind, number> = { prose: 5, graphic: 4, picture: 4 }

/** The range a page count may be asked in. */
export const MIN_PAGES = 4
export const MAX_PAGES = 320

export function clampPages(pages: number): number {
  if (!Number.isFinite(pages)) return MIN_PAGES
  return Math.min(MAX_PAGES, Math.max(MIN_PAGES, Math.round(pages)))
}

/** The shape of a book asked for as an exact number of pages. */
export function shapeForPages(kind: ShapeKind, pages: number): {
  chapters: number
  pages: number
} {
  const per = PER_CHAPTER[kind]
  return { chapters: Math.max(1, Math.ceil(clampPages(pages) / per)), pages: per }
}

export function chaptersIn(
  kind: ShapeKind, length: 'short' | 'medium' | 'long', pages?: number,
): number {
  if (pages) return shapeForPages(kind, pages).chapters
  return SHAPES[kind][length].chapters
}

/** How many pages that comes to — what the length buttons offer. */
export function pagesIn(
  kind: ShapeKind, length: 'short' | 'medium' | 'long', pages?: number,
): number {
  const shape = pages ? shapeForPages(kind, pages) : SHAPES[kind][length]
  return shape.chapters * shape.pages
}

/** How many chapters one planning call asks for; mirrors the endpoint. */
export const OUTLINE_BATCH = 10

/**
 * Whether a book looks like it stopped part-way through being written.
 *
 * Only ever true for a book the app was writing: one somebody is typing
 * themselves is never unfinished, it is simply as long as they have got.
 */
export function stoppedShort(book: {
  chapters: unknown[]
  writing?: { wanted: number }
}): boolean {
  return Boolean(book.writing) && book.chapters.length < (book.writing?.wanted ?? 0)
}
