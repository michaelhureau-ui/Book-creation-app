import type { Balloon, Book, Page, Panel } from '@/types'
import { loadImages } from '@/lib/graphic/assets'
import { layoutOf } from '@/lib/graphic/layouts'
import { artRect, assetIdsOf, pageGeometry, sourceRect, type TrimId } from '@/lib/graphic/render'
import {
  bandFor, detailMap, emptyMap, fitBalloons, fitBalloonsAbove,
  type DetailMap, type Faces, type FitMode, type People,
} from '@/lib/graphic/fit'
import { LOOK_SIZE, LookFailed, seePanel, thumbnailOf, type Seen } from '@/lib/graphic/see'

/** How finely the artwork is read. Twelve across is a face or two per cell. */
const GRID = 12
/** The sample drawn for reading; small, because only broad strokes matter. */
const SAMPLE = 72

export interface FitProgress {
  page: number
  pages: number
  moved: number
  /** Panels whose picture was actually looked at to find the speaker. */
  looked: number
  /** Why looking stopped, if it did; the fitting carries on regardless. */
  blind?: string
}

/** Who speaks in this panel, in the order they first speak. */
export function speakersIn(panel: Panel): string[] {
  const seen: string[] = []
  for (const balloon of panel.balloons) {
    const speaks = balloon.kind === 'speech' || balloon.kind === 'thought' || balloon.kind === 'shout'
    const who = (balloon.speaker ?? '').trim()
    if (!speaks || !who) continue
    if (!seen.some((name) => name.toLowerCase() === who.toLowerCase())) seen.push(who)
  }
  return seen
}

/** The located people, keyed the way the fitter looks them up. */
export function peopleOf(seen: Seen): People {
  return new Map(seen.people.map((p) => [p.name.trim().toLowerCase(), { x: p.x, y: p.y }]))
}

interface Read {
  map: DetailMap
  people?: People
  faces: Faces
}

/**
 * Fit a book's lettering to its artwork, a page at a time.
 *
 * Two things decide where a balloon goes, and only one of them can be read off
 * the pixels. How busy a part of the picture is, yes. *Which part of it is the
 * person speaking*, no — edge energy finds a brick wall or a tree line long
 * before it finds a face, and a smooth cheek is one of the quietest places in
 * a painted frame. So each drawn panel is shown to a service that can see it
 * and asked where the characters are, and the tails go on their faces.
 *
 * If that service is switched off, offline or refuses, the fitting still runs
 * on the pixels alone and says so: a worse-aimed tail is better than a book
 * that would not letter at all.
 *
 * Only panels with artwork are looked at: a panel still waiting to be drawn
 * has nothing to letter around.
 */
export async function fitBookLettering(
  book: Book,
  trim: TrimId,
  apply: (pageId: string, panelId: string, balloons: Balloon[], band: number) => void,
  onProgress: (progress: FitProgress) => void,
  signal?: AbortSignal,
  mode: FitMode = 'band',
  look = true,
): Promise<FitProgress> {
  const images = await loadImages(assetIdsOf(book.pages))
  const geo = pageGeometry({ trim, dpi: 150 })
  const frames = (page: Page) => layoutOf(page.layout).frames

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot read the artwork.')

  // A second, larger canvas for the thumbnail that is sent to be looked at:
  // the reading sample is far too small to make out a face in.
  const shot = document.createElement('canvas')
  const shotCtx = shot.getContext('2d')

  let moved = 0
  let looked = 0
  let blind: string | undefined
  /** Once looking has failed for a reason that will not change, stop asking. */
  let giveUp = false

  for (const [index, page] of book.pages.entries()) {
    if (signal?.aborted) break
    onProgress({ page: index, pages: book.pages.length, moved, looked, blind })

    // Each panel of the page is read, and the ones with people in them are
    // looked at — together, so a page costs one wait rather than three.
    const reads = await Promise.all(page.panels.map(async (panel, panelIndex): Promise<Read | null> => {
      const frame = frames(page)[panelIndex]
      if (!frame) return null
      const image = panel.assetId ? images.get(panel.assetId) : undefined
      if (panel.balloons.length === 0) return null
      if (!image && mode === 'over') return null

      const rect = {
        x: frame.x * geo.width,
        y: frame.y * geo.height,
        w: frame.w * geo.width,
        h: frame.h * geo.height,
      }

      const blank = emptyMap(GRID, GRID)
      if (!image) return { map: blank, faces: [] }

      // The strip is settled before the picture is read, because the strip is
      // what decides how the picture is cropped and scaled into the rest of
      // the frame. Reading the whole artwork instead would describe a picture
      // the reader is never shown.
      const band = mode === 'band' ? bandFor(panel.balloons, rect.w / rect.h) : 0
      const art = artRect({ ...panel, letterBand: band }, rect)

      let map = blank
      const { sx, sy, sw, sh } = sourceRect(panel, image, art)
      ctx.clearRect(0, 0, SAMPLE, SAMPLE)
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, SAMPLE, SAMPLE)
      try {
        map = detailMap(ctx.getImageData(0, 0, SAMPLE, SAMPLE), GRID, GRID)
      } catch { /* a canvas the browser will not let us read is no reason to stop */ }

      const names = speakersIn(panel)
      if (!look || giveUp || names.length === 0 || !shotCtx) return { map, faces: [] }

      // The thumbnail is the artwork as it will be drawn, in its own shape, so
      // the fractions that come back describe the picture the reader sees.
      const aspect = art.w / art.h
      shot.width = aspect >= 1 ? LOOK_SIZE : Math.round(LOOK_SIZE * aspect)
      shot.height = aspect >= 1 ? Math.round(LOOK_SIZE / aspect) : LOOK_SIZE
      shotCtx.clearRect(0, 0, shot.width, shot.height)
      shotCtx.drawImage(image, sx, sy, sw, sh, 0, 0, shot.width, shot.height)
      const thumbnail = thumbnailOf(shot)
      if (!thumbnail) return { map, faces: [] }

      try {
        const seen = await seePanel(thumbnail, names, panel.note ?? '', signal)
        looked++
        return { map, people: peopleOf(seen), faces: seen.faces }
      } catch (err) {
        if (err instanceof LookFailed) {
          blind ??= err.message
          // A missing endpoint or a missing key will not fix itself part-way
          // through a book; one bad panel might, so only give up on the
          // reasons that are settled.
          if (err.code === 'not_configured' || err.code === 'stale_build' || err.code === 'network') {
            giveUp = true
          }
        }
        return { map, faces: [] }
      }
    }))

    page.panels.forEach((panel, panelIndex) => {
      const read = reads[panelIndex]
      if (!read) return
      const frame = frames(page)[panelIndex]
      if (!frame) return
      const aspect = (frame.w * geo.width) / (frame.h * geo.height)

      const { fitted, band } = mode === 'band'
        ? (() => {
          const out = fitBalloonsAbove(panel.balloons, aspect, read.map, read.people)
          return { fitted: out.balloons, band: out.band }
        })()
        : {
          fitted: fitBalloons(panel.balloons, read.map, aspect, read.people, read.faces),
          band: 0,
        }

      const changed = fitted.some((b, i) =>
        Math.abs(b.x - panel.balloons[i].x) > 0.001 || Math.abs(b.y - panel.balloons[i].y) > 0.001)
      if (changed) moved += fitted.length
      apply(page.id, panel.id, fitted, band)
    })

    // Let the page breathe, so a long book does not lock the screen solid.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const done = { page: book.pages.length, pages: book.pages.length, moved, looked, blind }
  onProgress(done)
  return done
}
