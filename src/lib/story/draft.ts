import type { ArtStyle } from '@/lib/graphic/image-prompt'
import type { BookKind } from '@/types'
import type { StoryLength } from '@/lib/story/story'

/** Everything typed into the story form, kept so closing it loses nothing. */
export interface StoryDraft {
  source: 'own' | 'show'
  show: string
  retell: boolean
  idea: string
  kind: BookKind
  length: StoryLength
  audience: string
  draw: boolean
  style: ArtStyle
}

const KEY = 'bookwright:story-draft'

/**
 * The story form remembers itself.
 *
 * Describing a book takes real thought, and the form threw that away the
 * moment it was closed — a stray click on the backdrop and a paragraph of
 * careful description was gone. It is kept in the browser as it is typed, and
 * cleared once the book it describes has been written.
 *
 * Browser storage can be absent or refuse to answer — a private window, blocked
 * site data — so every read and write here is allowed to fail quietly. A
 * forgotten draft is a disappointment; a form that will not open is a fault.
 */
export function loadDraft(): Partial<StoryDraft> | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoryDraft>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function saveDraft(draft: StoryDraft): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(draft))
  } catch { /* nothing to be done, and nothing worth saying */ }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch { /* as above */ }
}

/** Is there anything in this draft worth keeping? */
export function draftHasWriting(draft: Partial<StoryDraft> | null): boolean {
  return Boolean(draft && ((draft.idea ?? '').trim() || (draft.show ?? '').trim()))
}
