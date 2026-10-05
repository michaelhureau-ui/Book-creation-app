import type { Book } from '@/types'
import {
  buildGraphicPage, buildProseChapter, readGraphicPages, readOutline, readProsePages,
  startBook, type Outline, type StoryKind, type StoryLength,
} from '@/lib/story/story'

export type StoryErrorCode =
  | 'not_configured' | 'empty_idea' | 'rejected' | 'rate_limited' | 'quota'
  | 'provider_error' | 'network' | 'unreadable' | 'stale_build'

export class StoryFailed extends Error {
  readonly code: StoryErrorCode
  constructor(code: StoryErrorCode, message: string) {
    super(message)
    this.name = 'StoryFailed'
    this.code = code
  }
}

interface Ask {
  stage: 'outline' | 'chapter'
  idea: string
  kind: StoryKind
  length: StoryLength
  audience: string
  outline?: Outline
  index?: number
}

async function ask(body: Ask, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch('/api/generate-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new StoryFailed('network', 'Could not reach the story service. Check your connection.')
  }

  if (!response.ok) {
    const parsed = await response.json().catch(() => null) as
      { error?: { code?: StoryErrorCode; message?: string } } | null
    if (parsed?.error?.code) {
      throw new StoryFailed(parsed.error.code, parsed.error.message ?? 'The story could not be written.')
    }
    // A 404 with no error body means this build predates story writing. Saying
    // "the service failed" would send someone hunting for a key problem.
    if (response.status === 404) {
      throw new StoryFailed(
        'stale_build',
        'This version of the app was built before story writing existed, so there is nothing here to ask.',
      )
    }
    throw new StoryFailed('provider_error', `The story service failed (${response.status}).`)
  }

  const parsed = await response.json().catch(() => null)
  if (!parsed || typeof parsed !== 'object') {
    throw new StoryFailed('unreadable', 'The story came back unreadable. Try again.')
  }
  return parsed as Record<string, unknown>
}

export interface StoryProgress {
  /** 0 while planning, then the number of chapters finished. */
  done: number
  total: number
  label: string
}

/**
 * Plan the book, then write it a chapter at a time.
 *
 * One call for a whole book is slow enough to hit the function's ceiling and
 * easy to have truncated, so the work is split — which also means there is
 * something true to report while it runs. The book is handed back only once
 * every chapter is in, so a half-written book never reaches the library.
 */
export async function writeStory(
  idea: string,
  kind: StoryKind,
  length: StoryLength,
  audience: string,
  onProgress: (progress: StoryProgress) => void,
  signal?: AbortSignal,
): Promise<Book> {
  if (!idea.trim()) {
    throw new StoryFailed('empty_idea', 'Say what the story should be about first.')
  }

  onProgress({ done: 0, total: 1, label: 'Planning the book…' })
  const outline = readOutline((await ask({ stage: 'outline', idea, kind, length, audience }, signal)).outline)

  const total = outline.chapters.length
  const book = startBook(outline, kind)

  for (let i = 0; i < total; i++) {
    const chapter = outline.chapters[i]
    onProgress({ done: i, total, label: `Writing “${chapter.title}” — ${i + 1} of ${total}…` })
    const reply = await ask(
      { stage: 'chapter', idea, kind, length, audience, outline, index: i }, signal)

    if (kind === 'graphic') {
      const written = buildProseChapter(chapter.title, [''])
      book.chapters.push(written)
      for (const page of readGraphicPages(reply.chapter)) {
        book.pages.push(buildGraphicPage(page, written.id))
      }
    } else {
      book.chapters.push(buildProseChapter(chapter.title, readProsePages(reply.chapter)))
    }
  }

  onProgress({ done: total, total, label: 'Finishing up…' })
  return book
}

/** What to tell the writer when story writing is switched off on this deployment. */
export const NOT_CONFIGURED_HELP =
  'Add a GOOGLE_API_KEY (free tier at aistudio.google.com) or an OPENAI_API_KEY environment variable to this app on Vercel, then redeploy. Until then you can still write the book yourself.'

export const STALE_BUILD_HELP =
  'Open the newest deployment of the app — or redeploy the latest commit — and try again.'
