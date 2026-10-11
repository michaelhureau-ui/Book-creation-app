import type { Book, Chapter, Page } from '@/types'
import { generatePanelArt, GenerationFailed } from '@/lib/graphic/generate'
import { panelAspect } from '@/components/graphic/geometry'
import { brief, withoutNames } from '@/lib/graphic/brief'
import type { ArtStyle } from '@/lib/graphic/image-prompt'
import {
  buildGraphicPage, buildProseChapter, planFromWritten, readGraphicPages, readOutline,
  readProsePages, startBook, type Outline, type StoryKind, type StoryLength,
} from '@/lib/story/story'
import {
  chaptersIn, OUTLINE_BATCH, pagesIn, shapeForPages, SHAPES,
} from '@/lib/story/limits'

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
  /** Chapters already planned, when a planning call continues an earlier one. */
  sofar?: { title: string; summary: string }[]
  /** The title the first planning call settled on. */
  title?: string
  idea: string
  kind: StoryKind
  length: StoryLength
  audience: string
  /** The show or film the story is set in, if any. */
  show?: string
  /** Tell that show's own story again, rather than a new adventure in it. */
  retell?: boolean
  outline?: Outline
  index?: number
  /** The exact shape asked for, when it was given as a number of pages. */
  want?: { chapters: number; pages: number }
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
  show = '',
  retell = false,
  /** An exact number of pages, instead of one of the three named lengths. */
  pages?: number,
): Promise<{ bookId: string; chapters: number }> {
  if (!idea.trim() && !show.trim()) {
    throw new StoryFailed('empty_idea', 'Say what the story should be about, or name a show or film.')
  }

  const want = pages ? shapeForPages(kind, pages) : undefined
  const outline = await planBook(idea, kind, length, audience, show, retell, hooks, signal, want)

  const wanted = chaptersIn(kind, length, pages)
  const book = startBook(outline, kind)
  book.writing = {
    idea, show, retell, audience, length, wanted, pages,
    chapters: outline.chapters,
    cast: outline.cast,
  }
  const bookId = await hooks.onStart(book)

  const written = await writeChapters(
    { idea, kind, length, audience, show, retell, outline, want }, bookId, 0, hooks, signal)
  const total = outline.chapters.length
  // A plan shorter than the book asked for makes a shorter book, and saying
  // nothing about it leaves someone counting pages and wondering.
  if (written > 0 && total < wanted) {
    throw new StoryFailed(
      'unreadable',
      `The plan for this book only came back with ${total} `
      + `${total === 1 ? 'chapter' : 'chapters'} instead of ${wanted}, so it is `
      + `${total * (want?.pages ?? SHAPES[kind][length].pages)} pages rather than `
      + `${pagesIn(kind, length, pages)}. `
      + 'Everything written is saved. '
      + 'Try again — the next plan is usually the right length.',
    )
  }
  return { bookId, chapters: written }
}

interface Brief {
  idea: string
  kind: StoryKind
  length: StoryLength
  audience: string
  show: string
  retell: boolean
  outline: Outline
  /** The exact shape asked for, when it was not one of the named lengths. */
  want?: { chapters: number; pages: number }
}

/**
 * Write the chapters of a plan, from `from` onwards, saving each as it lands.
 *
 * Shared by writing a book and carrying one on, because they are the same job
 * started at a different place.
 */
async function writeChapters(
  brief: Brief, bookId: string, from: number, hooks: StoryHooks, signal?: AbortSignal,
): Promise<number> {
  const { idea, kind, length, audience, show, retell, outline, want } = brief
  const total = outline.chapters.length
  let written = 0

  for (let i = from; i < total; i++) {
    if (signal?.aborted) break
    const planned = outline.chapters[i]
    hooks.onProgress({ done: i, total, label: `Writing “${planned.title}” — ${i + 1} of ${total}…` })

    let reply: Record<string, unknown>
    try {
      reply = await askWithRetries(
        {
          stage: 'chapter', idea, kind, length, audience, show, retell, outline, index: i, want,
        }, signal)
    } catch (err) {
      if (written === 0 || signal?.aborted) throw err
      // The chapters so far are saved, but stopping quietly is how a book
      // asked for at two hundred pages came back at five with nothing said.
      throw new StoryFailed(
        err instanceof StoryFailed ? err.code : 'provider_error',
        `The book stopped at chapter ${i + 1} of ${total}. `
        + (err instanceof Error ? err.message : 'The story service failed.')
        + ' Open it and press “Carry on writing” to pick it up from there.',
      )
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
  return written
}

/**
 * Pick a half-written book back up and write the rest of it.
 *
 * A long book is dozens of calls to a service that sometimes stops answering,
 * so stopping part-way is ordinary rather than exceptional — and starting over
 * means losing chapters that were perfectly good. This carries on from the
 * chapter after the last one written.
 *
 * A book written before plans were kept, or one somebody wrote themselves, has
 * no plan to carry on from; its chapters are read back into a rough one so it
 * can be continued all the same.
 */
export async function continueStory(
  book: Book,
  hooks: StoryHooks,
  signal?: AbortSignal,
  /** Overrides for a book with nothing of its own to go on. */
  fallback?: { idea?: string; length?: StoryLength; audience?: string },
): Promise<{ bookId: string; chapters: number }> {
  const kind: StoryKind = book.kind
  const plan = book.writing
  const length = fallback?.length ?? plan?.length ?? 'medium'
  const idea = (fallback?.idea ?? plan?.idea ?? book.description ?? '').trim() || book.title
  const audience = fallback?.audience ?? plan?.audience ?? 'middle'
  const askedPages = plan?.pages
  const want = askedPages ? shapeForPages(kind, askedPages) : undefined
  const wanted = Math.max(chaptersIn(kind, length, askedPages), book.chapters.length)
  const done = book.chapters.length

  if (done >= wanted) {
    throw new StoryFailed('empty_idea', 'This book is already as long as it was meant to be.')
  }

  // What has been written is the plan up to here, whether it was kept or has to
  // be read back off the page.
  const chapters = plan?.chapters?.length
    ? plan.chapters.slice()
    : planFromWritten(book)

  const outline: Outline = {
    title: book.title,
    subtitle: book.subtitle,
    cast: plan?.cast ?? [],
    chapters,
  }

  // The plan may stop where the writing stopped; the rest is asked for now.
  const extended = await extendPlan(
    {
      idea, kind, length, audience, show: plan?.show ?? '', retell: plan?.retell ?? false,
      outline, want,
    },
    wanted, hooks, signal,
  )

  const written = await writeChapters(
    {
      idea, kind, length, audience, show: plan?.show ?? '', retell: plan?.retell ?? false,
      outline: extended, want,
    },
    book.id, done, hooks, signal,
  )
  return { bookId: book.id, chapters: written }
}

/**
 * Plan the book a few chapters at a time.
 *
 * Asking for forty chapters in one go does not come back inside the time a
 * serverless function is allowed — which is how a two-hundred-page book ended
 * up five pages long. Each call is given the chapters already planned, so the
 * parts join up, and whatever has been planned stays usable if a later call
 * fails.
 */
async function planBook(
  idea: string, kind: StoryKind, length: StoryLength, audience: string,
  show: string, retell: boolean, hooks: StoryHooks, signal?: AbortSignal,
  want?: { chapters: number; pages: number },
): Promise<Outline> {
  hooks.onProgress({ done: 0, total: 1, label: 'Planning the book…' })
  const first = readOutline((await askWithRetries(
    { stage: 'outline', idea, kind, length, audience, show, retell, want }, signal)).outline)
  return extendPlan(
    { idea, kind, length, audience, show, retell, outline: first, want },
    want?.chapters ?? chaptersIn(kind, length), hooks, signal,
  )
}

/**
 * Keep asking for the next few chapters until the plan is long enough.
 *
 * The same walk serves a new book and one being carried on: the only
 * difference is how many chapters it starts with.
 */
async function extendPlan(
  brief: Brief, wanted: number, hooks: StoryHooks, signal?: AbortSignal,
): Promise<Outline> {
  const { idea, kind, length, audience, show, retell, outline, want } = brief
  const chapters = [...outline.chapters]

  while (chapters.length < wanted) {
    if (signal?.aborted) break
    hooks.onProgress({
      done: chapters.length,
      total: wanted,
      label: `Planning chapters ${chapters.length + 1} to `
        + `${Math.min(chapters.length + OUTLINE_BATCH, wanted)}…`,
    })
    let more: Outline
    try {
      more = readOutline((await askWithRetries({
        stage: 'outline', idea, kind, length, audience, show, retell, want,
        sofar: chapters, title: outline.title,
      }, signal)).outline)
    } catch {
      // A plan that stops short still makes a book, and the length check at
      // the end is what tells the writer it is shorter than they asked for.
      break
    }
    // readOutline never returns nothing, so an empty answer arrives as one
    // placeholder chapter — taking it would loop forever on a model that has
    // run out of ideas.
    const added = more.chapters.filter((c) => c.summary.trim().length > 0)
    if (added.length === 0) break
    chapters.push(...added.slice(0, wanted - chapters.length))
  }

  return { ...outline, chapters }
}

/** Failures worth trying again: the service was busy, not the request wrong. */
const PASSING = new Set<StoryErrorCode>(['network', 'provider_error', 'rate_limited'])

/**
 * Ask again when the answer was a passing failure.
 *
 * A long book is forty requests in a row, so a one-in-forty blip is near enough
 * a certainty, and losing the rest of the book to it is the worst outcome
 * available. Three tries with a pause between covers an overloaded model
 * without hammering it.
 */
async function askWithRetries(
  body: Ask, signal?: AbortSignal, waits = [1500, 4000],
): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ask(body, signal)
    } catch (err) {
      const passing = err instanceof StoryFailed && PASSING.has(err.code)
      if (!passing || attempt >= waits.length || signal?.aborted) throw err
      await new Promise((resolve) => setTimeout(resolve, waits[attempt]))
    }
  }
}

/** What to tell the writer when story writing is switched off on this deployment. */
export const NOT_CONFIGURED_HELP =
  'Add a GOOGLE_API_KEY (free tier at aistudio.google.com) or an OPENAI_API_KEY environment variable to this app on Vercel, then redeploy. Until then you can still write the book yourself.'

export const STALE_BUILD_HELP =
  'Open the newest deployment of the app — or redeploy the latest commit — and try again.'

/**
 * What to tell the writer when the provider says the account cannot pay.
 *
 * A credit balance at zero stops every model on the key, the free allowance
 * included, so there is nothing to wait for and nothing to retry — someone has
 * to top the account up or swap the key. Say that, rather than leaving a child
 * clicking "write it" at a wall.
 */
export const QUOTA_HELP =
  'Nothing in the app can get round this one. Open aistudio.google.com with the account the key'
  + ' belongs to, add credit (or make a key in a fresh project), and put it on the app as'
  + ' GOOGLE_API_KEY. Writing the book yourself still works, and so does everything else.'

/** One model's answer when the key was checked against it. */
export interface ServiceCheck {
  provider: string | null
  listed: number
  tried: { model: string; status: number; ok: boolean; reason: string }[]
  wrote: string | null
}

/**
 * Ask the app which models its key may actually use.
 *
 * Twice a fix for "the story will not write" went out on a guess about that,
 * because the only place the answer lived was a deployment log nobody at the
 * kitchen table can read. This puts it on screen instead.
 */
export async function checkStoryService(): Promise<ServiceCheck> {
  const res = await fetch('/api/generate-story?probe=models')
  if (!res.ok) throw new StoryFailed('network', 'The check could not be run.')
  const body = await res.json() as Partial<ServiceCheck> & { probe?: string }
  if (body.probe) throw new StoryFailed('not_configured', body.probe)
  return {
    provider: body.provider ?? null,
    listed: body.listed ?? 0,
    tried: body.tried ?? [],
    wrote: body.wrote ?? null,
  }
}

export interface DrawingProgress {
  drawn: number
  total: number
  /** Set once drawing has stopped early, with the reason. */
  stopped?: string
  /** Panels the service would not draw, which it carried on past. */
  failed?: number
  /** What it said about the first of them, so "nothing happened" never is. */
  reason?: string
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
  // Names are swapped for descriptions before anything is sent: a picture
  // service cannot draw "Rell", and refuses outright to draw anyone it does
  // recognise.
  const cast = book.writing?.cast ?? []
  const jobs = book.pages.flatMap((page) =>
    page.panels.flatMap((panel, panelIndex) =>
      !panel.assetId && (panel.note ?? '').trim()
        ? [{
          page,
          panel,
          note: brief(panel.note ?? '', cast),
          aspect: panelAspect(page, panelIndex, 'comic'),
        }]
        : []))

  let drawn = 0
  let failed = 0
  let reason = ''

  for (const job of jobs) {
    if (signal?.aborted) return { drawn, total: jobs.length, stopped: 'You stopped it.', failed, reason }
    onProgress({ drawn, total: jobs.length, failed, reason })
    try {
      const assetId = await drawOnePanel(book.id, job, style, signal)
      place(job.page.id, job.panel.id, assetId)
      drawn++
    } catch (err) {
      if (signal?.aborted) return { drawn, total: jobs.length, stopped: 'You stopped it.', failed, reason }
      if (!(err instanceof GenerationFailed)) throw err
      // A spent allowance or a refused key will refuse every panel after this
      // one too, so there is nothing to be gained by working through the rest.
      if (err.code === 'quota' || err.code === 'rate_limited' || err.code === 'not_configured') {
        return { drawn, total: jobs.length, stopped: err.message, failed, reason }
      }
      // A single picture the service would not draw is worth skipping — but
      // skipping it in silence is how "I pressed draw and nothing happened"
      // happens, so it is counted and the first reason is kept.
      failed++
      if (!reason) reason = err.message
    }
  }

  const done = { drawn, total: jobs.length, failed, reason }
  onProgress(done)
  return done
}

/** Transient failures worth another go: the service was busy, not the brief wrong. */
const PASSING_ART = new Set(['network', 'provider_error', 'stale_build'])

/**
 * One panel, with a second and third go at a passing failure.
 *
 * A book is hundreds of pictures in a row, so a one-in-a-hundred blip is a
 * certainty rather than a possibility, and losing a panel to one is a hole in
 * the page nobody asked for.
 */
async function drawOnePanel(
  bookId: string,
  job: { note: string; aspect: number },
  style: ArtStyle,
  signal?: AbortSignal,
  waits = [1200, 3500],
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generatePanelArt(bookId, job.note, style, job.aspect, signal)
    } catch (err) {
      const failure = err instanceof GenerationFailed ? err : null
      if (!failure || signal?.aborted) throw err

      // A refused brief will be refused again however long we wait — but a
      // refusal is usually about a name in it, so it is worth one go with the
      // names taken out before the panel is given up on.
      if (failure.code === 'rejected') {
        if (attempt > 0) throw err
        try {
          return await generatePanelArt(bookId, withoutNames(job.note), style, job.aspect, signal)
        } catch {
          throw err
        }
      }

      if (!PASSING_ART.has(failure.code) || attempt >= waits.length) throw err
      await new Promise((resolve) => setTimeout(resolve, waits[attempt]))
    }
  }
}
