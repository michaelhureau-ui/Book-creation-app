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
export const SHAPES: Record<'prose' | 'graphic', Record<'short' | 'medium' | 'long', {
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
}

export function chaptersIn(kind: 'prose' | 'graphic', length: 'short' | 'medium' | 'long'): number {
  return SHAPES[kind][length].chapters
}

/** How many pages that comes to — what the length buttons offer. */
export function pagesIn(kind: 'prose' | 'graphic', length: 'short' | 'medium' | 'long'): number {
  const shape = SHAPES[kind][length]
  return shape.chapters * shape.pages
}

/** How many chapters one planning call asks for; mirrors the endpoint. */
export const OUTLINE_BATCH = 10
