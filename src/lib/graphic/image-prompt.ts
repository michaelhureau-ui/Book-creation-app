/**
 * The browser half of image generation: the styles offered in the UI and the
 * error shapes the endpoint reports back.
 *
 * The prompt wording and provider handling live in `api/generate-image.ts`,
 * which must be self-contained to deploy — a unit test checks that the style
 * ids here match the ones the server knows, so the two cannot drift.
 */

export type ArtStyle = 'ink' | 'color' | 'noir' | 'manga' | 'watercolour' | 'retro'

export interface StyleOption {
  id: ArtStyle
  label: string
}

export const STYLES: StyleOption[] = [
  { id: 'color', label: 'Comic colour' },
  { id: 'ink', label: 'Ink line art' },
  { id: 'noir', label: 'Noir' },
  { id: 'manga', label: 'Manga' },
  { id: 'watercolour', label: 'Watercolour' },
  { id: 'retro', label: 'Retro print' },
]

export function styleOf(id: ArtStyle): StyleOption {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}

export const MAX_SUBJECT_LENGTH = 300

/** Trim and collapse what the writer typed; empty means nothing to draw. */
export function cleanSubject(subject: string): string {
  return subject.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_LENGTH)
}

/** Error shapes the browser needs to tell apart, so it can explain each one. */
export type GenerateErrorCode =
  | 'not_configured'
  | 'empty_prompt'
  | 'rejected'
  | 'rate_limited'
  | 'quota'
  | 'provider_error'
  | 'network'

export interface GenerateError {
  code: GenerateErrorCode
  message: string
}
