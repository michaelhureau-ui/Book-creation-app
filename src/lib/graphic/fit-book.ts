import type { Balloon, Book, Page } from '@/types'
import { loadImages } from '@/lib/graphic/assets'
import { layoutOf } from '@/lib/graphic/layouts'
import { assetIdsOf, pageGeometry, sourceRect, type TrimId } from '@/lib/graphic/render'
import {
  detailMap, emptyMap, fitBalloons, fitBalloonsAbove, type FitMode,
} from '@/lib/graphic/fit'

/** How finely the artwork is read. Twelve across is a face or two per cell. */
const GRID = 12
/** The sample drawn for reading; small, because only broad strokes matter. */
const SAMPLE = 72

export interface FitProgress {
  page: number
  pages: number
  moved: number
}

/**
 * Fit a book's lettering to its artwork, a page at a time.
 *
 * Each panel's visible crop — exactly what the reader sees, zoom and pan
 * included — is drawn small, read for where the detail is, and the balloons
 * are placed over the quiet parts with their tails on whoever is speaking.
 *
 * Only panels with artwork are touched: a panel still waiting to be drawn has
 * nothing to letter around, and moving its balloons now would only have to be
 * undone later.
 */
export async function fitBookLettering(
  book: Book,
  trim: TrimId,
  apply: (pageId: string, panelId: string, balloons: Balloon[], band: number) => void,
  onProgress: (progress: FitProgress) => void,
  signal?: AbortSignal,
  mode: FitMode = 'band',
): Promise<FitProgress> {
  const images = await loadImages(assetIdsOf(book.pages))
  const geo = pageGeometry({ trim, dpi: 150 })
  const frames = (page: Page) => layoutOf(page.layout).frames

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot read the artwork.')

  let moved = 0
  for (const [index, page] of book.pages.entries()) {
    if (signal?.aborted) break
    onProgress({ page: index, pages: book.pages.length, moved })

    page.panels.forEach((panel, panelIndex) => {
      const frame = frames(page)[panelIndex]
      if (!frame) return
      const image = panel.assetId ? images.get(panel.assetId) : undefined
      if (panel.balloons.length === 0) return
      if (!image && mode === 'over') return

      const rect = {
        x: frame.x * geo.width,
        y: frame.y * geo.height,
        w: frame.w * geo.width,
        h: frame.h * geo.height,
      }
      let map = emptyMap(GRID, GRID)
      if (image) {
        const { sx, sy, sw, sh } = sourceRect(panel, image, rect)
        ctx.clearRect(0, 0, SAMPLE, SAMPLE)
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, SAMPLE, SAMPLE)
        try {
          map = detailMap(ctx.getImageData(0, 0, SAMPLE, SAMPLE), GRID, GRID)
        } catch { /* a canvas the browser will not let us read is no reason to stop */ }
      }

      const aspect = rect.w / rect.h
      const { fitted, band } = mode === 'band'
        ? (() => {
          const out = fitBalloonsAbove(panel.balloons, aspect, map)
          return { fitted: out.balloons, band: out.band }
        })()
        : { fitted: fitBalloons(panel.balloons, map, aspect), band: 0 }

      const changed = fitted.some((b, i) =>
        Math.abs(b.x - panel.balloons[i].x) > 0.001 || Math.abs(b.y - panel.balloons[i].y) > 0.001)
      if (changed) moved += fitted.length
      apply(page.id, panel.id, fitted, band)
    })

    // Let the page breathe, so a long book does not lock the screen solid.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const done = { page: book.pages.length, pages: book.pages.length, moved }
  onProgress(done)
  return done
}
