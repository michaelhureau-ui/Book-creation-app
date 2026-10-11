import type { Balloon, Book, Page, Panel } from '@/types'
import { loadImages } from '@/lib/graphic/assets'
import { layoutOf } from '@/lib/graphic/layouts'
import { createBalloon } from '@/lib/graphic/pages'
import { assetIdsOf, pageGeometry, sourceRect, type TrimId } from '@/lib/graphic/render'
import { fitBalloonsAbove, type People } from '@/lib/graphic/fit'
import { LOOK_SIZE, thumbnailOf } from '@/lib/graphic/see'

/**
 * Writing the words onto pictures that already exist.
 *
 * The other way round — words first, pictures to match — is how every comic in
 * this app was made until now, and it shows: a balloon sits where an empty
 * panel suggested, the dialogue mentions something the picture does not have
 * in it, and nothing can point a tail at a character because nothing knows
 * where the character is.
 *
 * This walks the drawn book a page at a time, shows each page's panels to the
 * service, and takes back the words for them and the positions of whoever is
 * speaking. The balloons then go in the clear strip above the artwork with
 * their tails on the speakers' faces.
 */

export interface LetterProgress {
  page: number
  pages: number
  /** Balloons written so far. */
  written: number
  label: string
}

export class LetteringFailed extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'LetteringFailed'
    this.code = code
  }
}

interface WrittenBalloon {
  kind: Balloon['kind']
  speaker: string
  text: string
}

interface LetteredPanel {
  balloons: WrittenBalloon[]
  people: { name: string; x: number; y: number }[]
}

export interface LetterRequest {
  kind: 'graphic' | 'picture'
  title: string
  story: string
  cast: { name: string; look: string }[]
  panels: { image: string; beat: string }[]
}

export async function letterPage(
  request: LetterRequest, signal?: AbortSignal,
): Promise<LetteredPanel[]> {
  let response: Response
  try {
    response = await fetch('/api/letter-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch {
    throw new LetteringFailed('network', 'Could not reach the service that writes the words.')
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new LetteringFailed(
        'stale_build',
        'This version of the app was built before it could write words onto pictures.',
      )
    }
    const body = await response.json().catch(() => null) as
      { error?: { code?: string; message?: string } } | null
    throw new LetteringFailed(
      body?.error?.code ?? 'provider_error',
      body?.error?.message ?? `Writing the words failed (${response.status}).`,
    )
  }

  const body = await response.json().catch(() => null) as { panels?: LetteredPanel[] } | null
  return body?.panels ?? []
}

/** Which panels of a page are drawn, and therefore have something to letter. */
export function drawnPanels(page: Page): { panel: Panel; index: number }[] {
  const frames = layoutOf(page.layout).frames
  return page.panels
    .map((panel, index) => ({ panel, index }))
    .filter(({ panel, index }) => Boolean(panel.assetId) && Boolean(frames[index]))
}

export interface LetterHooks {
  onProgress: (progress: LetterProgress) => void
  apply: (pageId: string, panelId: string, balloons: Balloon[], band: number) => void
}

export interface LetterOptions {
  kind: 'graphic' | 'picture'
  trim: TrimId
  /** Leave panels that already carry words alone. */
  skipLettered?: boolean
}

/**
 * Letter a whole book from its artwork.
 *
 * Every page is independent, so a failure part way through leaves the pages
 * already written — which matters, because this is one call per page and a
 * long book is a lot of calls.
 */
export async function letterBook(
  book: Book,
  opts: LetterOptions,
  hooks: LetterHooks,
  signal?: AbortSignal,
): Promise<{ written: number; pages: number; stopped?: string }> {
  const images = await loadImages(assetIdsOf(book.pages))
  const geo = pageGeometry({ trim: opts.trim, dpi: 150 })

  const shot = document.createElement('canvas')
  const ctx = shot.getContext('2d')
  if (!ctx) throw new Error('This browser cannot read the artwork.')

  const cast = book.writing?.cast ?? []
  let written = 0
  let stopped: string | undefined

  for (const [index, page] of book.pages.entries()) {
    if (signal?.aborted) break
    hooks.onProgress({
      page: index,
      pages: book.pages.length,
      written,
      label: `Writing the words for page ${index + 1} of ${book.pages.length}…`,
    })

    const drawn = drawnPanels(page)
    const wanted = opts.skipLettered
      ? drawn.filter(({ panel }) => panel.balloons.length === 0)
      : drawn
    if (wanted.length === 0) continue

    const frames = layoutOf(page.layout).frames
    const shots: { image: string; beat: string }[] = []
    for (const { panel, index: panelIndex } of wanted) {
      const image = panel.assetId ? images.get(panel.assetId) : undefined
      const frame = frames[panelIndex]
      if (!image || !frame) continue
      const rect = {
        x: frame.x * geo.width,
        y: frame.y * geo.height,
        w: frame.w * geo.width,
        h: frame.h * geo.height,
      }
      const { sx, sy, sw, sh } = sourceRect(panel, image, rect)
      const aspect = rect.w / rect.h
      shot.width = aspect >= 1 ? LOOK_SIZE : Math.round(LOOK_SIZE * aspect)
      shot.height = aspect >= 1 ? Math.round(LOOK_SIZE / aspect) : LOOK_SIZE
      ctx.clearRect(0, 0, shot.width, shot.height)
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, shot.width, shot.height)
      const thumbnail = thumbnailOf(shot)
      if (!thumbnail) continue
      shots.push({ image: thumbnail, beat: panel.beat ?? panel.note ?? '' })
    }
    if (shots.length === 0) continue

    let lettered: LetteredPanel[]
    try {
      lettered = await letterPage({
        kind: opts.kind,
        title: page.title,
        story: storySoFar(book, page),
        cast,
        panels: shots,
      }, signal)
    } catch (err) {
      if (signal?.aborted) break
      // Everything written up to here is kept; stopping in silence is how a
      // book came back half-lettered with nothing said about it.
      stopped = err instanceof Error ? err.message : 'The words could not be written.'
      break
    }

    wanted.forEach(({ panel, index: panelIndex }, i) => {
      const answer = lettered[i]
      if (!answer || answer.balloons.length === 0) return
      const frame = frames[panelIndex]
      if (!frame) return
      const aspect = (frame.w * geo.width) / (frame.h * geo.height)

      const fresh: Balloon[] = answer.balloons.map((b) => ({
        ...createBalloon(b.kind),
        text: b.text,
        ...(b.speaker ? { speaker: b.speaker } : {}),
      }))
      // Keep anything placed by hand; the new words join it.
      const kept = panel.balloons.filter((b) => b.placed)
      const people: People = new Map(
        answer.people.map((p) => [p.name.trim().toLowerCase(), { x: p.x, y: p.y }]),
      )
      const out = fitBalloonsAbove([...kept, ...fresh], aspect, undefined, people)
      written += fresh.length
      hooks.apply(page.id, panel.id, out.balloons, out.band)
    })

    // Let the page breathe, so a long book does not lock the screen solid.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const done = {
    written,
    pages: book.pages.length,
    ...(stopped ? { stopped } : {}),
  }
  hooks.onProgress({
    page: book.pages.length,
    pages: book.pages.length,
    written,
    label: 'Finished.',
  })
  return done
}

/**
 * What the writer needs to know to carry the story on: the chapter this page
 * belongs to, and the plan for it.
 */
function storySoFar(book: Book, page: Page): string {
  const plan = book.writing
  const chapterIndex = book.chapters.findIndex((c) => c.id === page.chapterId)
  const planned = chapterIndex >= 0 ? plan?.chapters?.[chapterIndex] : undefined
  const place = book.pages.findIndex((p) => p.id === page.id) + 1
  return [
    `"${book.title}"${plan?.idea ? `, from the idea: ${plan.idea}` : ''}.`,
    plan?.audience ? `Written for ${plan.audience} readers.` : '',
    planned ? `This page is in the chapter "${planned.title}": ${planned.summary}` : '',
    `It is page ${place} of ${book.pages.length}.`,
  ].filter(Boolean).join(' ')
}
