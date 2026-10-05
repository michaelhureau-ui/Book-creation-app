import type { Balloon, Page } from '@/types'
import { frameToRect, layoutOf } from '@/lib/graphic/layouts'
import { balloonPlacement, pageGeometry, trimOf, type TrimId } from '@/lib/graphic/render'

export interface PercentRect { left: number; top: number; width: number; height: number }

/**
 * Panel boxes as percentages of the page, for positioning DOM overlays on top
 * of the rendered canvas. Derived from the same geometry the renderer uses, so
 * the overlays land exactly on the drawn panels.
 */
export function panelRects(page: Page, trim: TrimId): PercentRect[] {
  const geo = pageGeometry({ trim, dpi: 100 })
  return layoutOf(page.layout).frames.map((frame) => {
    const rect = frameToRect(frame, geo)
    return {
      left: (rect.x / geo.width) * 100,
      top: (rect.y / geo.height) * 100,
      width: (rect.w / geo.width) * 100,
      height: (rect.h / geo.height) * 100,
    }
  })
}

export function aspectRatio(trim: TrimId): number {
  const t = trimOf(trim)
  return t.width / t.height
}

/**
 * Width ÷ height of one panel box. The drawing board matches this so a drawing
 * lands in its frame uncropped.
 */
export function panelAspect(page: Page, index: number, trim: TrimId): number {
  const rects = panelRects(page, trim)
  const rect = rects[index]
  if (!rect || rect.height === 0) return 1
  const pageAspect = aspectRatio(trim)
  // Percentages are of different page dimensions, so convert through the page.
  return (rect.width * pageAspect) / rect.height
}

/**
 * Where a balloon's move handle belongs, as a percentage of its panel box.
 *
 * Long lettering widens and slides to stay inside the panel, so the balloon is
 * not always centred on the point the writer dragged it to. Asking the renderer
 * where it actually put the balloon keeps the handle on the thing it moves.
 */
export function balloonHandle(
  page: Page, index: number, balloon: Balloon, trim: TrimId,
): { left: number; top: number } {
  const fallback = { left: balloon.x * 100, top: balloon.y * 100 }
  const frame = layoutOf(page.layout).frames[index]
  if (!frame) return fallback
  const geo = pageGeometry({ trim, dpi: 100 })
  const rect = frameToRect(frame, geo)
  const placed = balloonPlacement(balloon, rect, geo.width / 1000)
  if (!placed || rect.w === 0 || rect.h === 0) return fallback
  return {
    left: ((placed.cx - rect.x) / rect.w) * 100,
    top: ((placed.cy - rect.y) / rect.h) * 100,
  }
}
