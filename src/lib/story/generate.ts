import type { Book, Chapter, Page } from '@/types'
import { generatePanelArt, GenerationFailed } from '@/lib/graphic/generate'
import { panelAspect } from '@/components/graphic/geometry'
import type { ArtStyle } from '@/lib/graphic/image-prompt'
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

export interface StoryHooks {
  onProgress: (progress: StoryProgress) => void
  /** The book, as soon as there is one to put in the library. */
  onStart: (book: Book) => Promise<string>
  /** One finished chapter, with the comic pages belonging to it. */
  onChapter: (bookId: string, chapter: Chapter, pages: Page[]) => void
}

/**
 * Plan the book, then write it a chapter at a time.
 *
 * One call for a whole book is slow enough to hit the function's ceiling and
 * easy to have truncated, so the work is split — which also means there is
 * something true to report while it runs. At two hundred pages that is forty
 * calls and a quarter of an hour, so each chapter is saved to the library as
 * it lands: stopping early, or losing the connection, leaves a shorter book
 * rather than nothing.
 */
export async function writeStory(
  idea: string,
  kind: StoryKind,
  length: StoryLength,
  audience: string,
  hooks: StoryHooks,
  signal?: AbortSignal,
): Promise<{ bookId: string; chapters: number }> {
  if (!idea.trim()) {
    throw new StoryFailed('empty_idea', 'Say what the story should be about first.')
  }

  hooks.onProgress({ done: 0, total: 1, label: 'Planning the book…' })
  const outline = readOutline((await ask({ stage: 'outline', idea, kind, length, audience }, signal)).outline)

  const total = outline.chapters.length
  const bookId = await hooks.onStart(startBook(outline, kind))
  let written = 0

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break
    const planned = outline.chapters[i]
    hooks.onProgress({ done: i, total, label: `Writing “${planned.title}” — ${i + 1} of ${total}…` })

    let reply: Record<string, unknown>
    try {
      reply = await ask({ stage: 'chapter', idea, kind, length, audience, outline, index: i }, signal)
    } catch (err) {
      // Whatever is already written stays in the library; only say so if the
      // book would otherwise be empty.
      if (written === 0 || signal?.aborted) throw err
      break
    }

    if (kind === 'graphic') {
      const chapter = buildProseChapter(planned.title, [''])
      const pages = readGraphicPages(reply.chapter).map((page) => buildGraphicPage(page, chapter.id))
      hooks.onChapter(bookId, chapter, pages)
    } else {
      hooks.onChapter(bookId, buildProseChapter(planned.title, readProsePages(reply.chapter)), [])
    }
    written++
  }

  hooks.onProgress({ done: written, total, label: 'Finishing up…' })
  return { bookId, chapters: written }
}

/** What to tell the writer when story writing is switched off on this deployment. */
export const NOT_CONFIGURED_HELP =
  'Add a GOOGLE_API_KEY (free tier at aistudio.google.com) or an OPENAI_API_KEY environment variable to this app on Vercel, then redeploy. Until then you can still write the book yourself.'

export const STALE_BUILD_HELP =
  'Open the newest deployment of the app — or redeploy the latest commit — and try again.'

export interface DrawingProgress {
  drawn: number
  total: number
  /** Set once drawing has stopped early, with the reason. */
  stopped?: string
}

/**
 * Draw every panel of a written comic from the brief the story left on it.
 *
 * A fifty-page comic is a few hundred panels, and an image allowance runs out
 * long before that — so this stops at the first sign of a spent quota rather
 * than hammering the provider, and keeps every picture drawn up to that point.
 * One at a time, both to stay inside rate limits and so the book fills in
 * visibly rather than all at once at the end.
 */
export async function drawPanels(
  book: Book,
  style: ArtStyle,
  place: (pageId: string, panelId: string, assetId: string) => void,
  onProgress: (progress: DrawingProgress) => void,
  signal?: AbortSignal,
): Promise<DrawingProgress> {
  // The aspect is the panel's own frame, so artwork lands in it barely cropped.
  const jobs = book.pages.flatMap((page) =>
    page.panels.flatMap((panel, panelIndex) =>
      !panel.assetId && (panel.note ?? '').trim()
        ? [{ page, panel, aspect: panelAspect(page, panelIndex, 'comic') }]
        : []))

  let drawn = 0
  for (const job of jobs) {
    if (signal?.aborted) return { drawn, total: jobs.length, stopped: 'You stopped it.' }
    onProgress({ drawn, total: jobs.length })
    try {
      const assetId = await generatePanelArt(
        book.id, job.panel.note ?? '', style, job.aspect, signal)
      place(job.page.id, job.panel.id, assetId)
      drawn++
    } catch (err) {
      if (signal?.aborted) return { drawn, total: jobs.length, stopped: 'You stopped it.' }
      if (!(err instanceof GenerationFailed)) throw err
      // A spent allowance or a refused key will refuse every panel after this
      // one too. A single picture the model would not draw is worth skipping.
      if (err.code === 'quota' || err.code === 'rate_limited' || err.code === 'not_configured') {
        return { drawn, total: jobs.length, stopped: err.message }
      }
    }
  }

  const done = { drawn, total: jobs.length }
  onProgress(done)
  return done
}
