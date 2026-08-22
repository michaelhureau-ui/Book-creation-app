import type { Page } from '@/types'
import { frameToRect, layoutOf } from '@/lib/graphic/layouts'
import { pageGeometry, trimOf, type TrimId } from '@/lib/graphic/render'

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
