/**
 * Mirrors the limits the story endpoint enforces, so the form can stop someone
 * before a round trip. The endpoint has to be self-contained to deploy, so the
 * values are duplicated rather than imported — a unit test holds them equal.
 */
export const MAX_IDEA_LENGTH = 1200

export const STORY_LENGTHS = ['short', 'medium', 'long'] as const

export const STORY_AUDIENCES = ['children', 'middle', 'teen', 'adult'] as const
