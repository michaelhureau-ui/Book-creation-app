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
 * How many chapters each book is meant to have, mirroring the endpoint's
 * SHAPES. The app needs it to tell a short plan from the book that was asked
 * for — a plan with one chapter in it is a five-page book, and that used to
 * happen without a word being said.
 */
export const CHAPTERS_IN: Record<'short' | 'medium' | 'long', number> = {
  short: 10,
  medium: 20,
  long: 40,
}

/** How many chapters one planning call asks for; mirrors the endpoint. */
export const OUTLINE_BATCH = 10
