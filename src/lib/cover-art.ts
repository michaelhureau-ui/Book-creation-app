import { generatePanelArt } from '@/lib/graphic/generate'
import { importImage } from '@/lib/graphic/assets'
import { bookTitle } from '@/lib/book'
import type { ArtStyle } from '@/lib/graphic/image-prompt'
import type { Book } from '@/types'

/** A jacket is two units tall for every three— no: three tall for every two across. */
export const COVER_ASPECT = 2 / 3

/**
 * What to draw, when nobody has said.
 *
 * A cover is the one picture a reader sees before they have read a word, so it
 * should show the book rather than illustrate a scene from it: the thing the
 * story is about, with room at the top for the title. Taken from the book's own
 * words so the suggestion is never empty.
 */
export function suggestCoverBrief(book: Book): string {
  const title = bookTitle(book)
  const blurb = book.description.trim() || book.subtitle.trim()
  const subject = blurb ? `${title} — ${blurb}` : title
  return `Cover art for a book called "${title}". ${subject}. `
    + 'A single clear subject, plenty of open sky or space at the top for the title, no lettering.'
}

/**
 * Draw a cover and hand back the asset id.
 *
 * This is the panel drawer with a jacket's proportions; the one thing a cover
 * must not have is writing on it, since the app prints the real title over the
 * top and two sets of letters is how a cover looks like a mistake.
 */
export async function drawCoverArt(
  book: Book, brief: string, style: ArtStyle, signal?: AbortSignal,
): Promise<string> {
  return generatePanelArt(book.id, `${brief} No text, no words, no lettering.`, style, COVER_ASPECT, signal)
}

/** Use a picture from the writer's own device instead of a drawn one. */
export async function importCoverArt(book: Book, file: File): Promise<string> {
  const asset = await importImage(book.id, file)
  return asset.id
}
