import type { PageLayoutId } from '@/types'

/** A panel frame as a fraction of the page's live area. */
export interface Frame {
  x: number
  y: number
  w: number
  h: number
}

export interface PageLayout {
  id: PageLayoutId
  label: string
  frames: Frame[]
}

const H2 = (top: number, h: number): Frame[] => [
  { x: 0, y: top, w: 0.5, h },
  { x: 0.5, y: top, w: 0.5, h },
]

export const LAYOUTS: PageLayout[] = [
  { id: 'splash', label: 'Splash', frames: [{ x: 0, y: 0, w: 1, h: 1 }] },
  {
    id: 'two-rows', label: 'Two rows',
    frames: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }],
  },
  {
    id: 'three-rows', label: 'Three rows',
    frames: [
      { x: 0, y: 0, w: 1, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: 'three-columns', label: 'Three columns',
    frames: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ],
  },
  {
    id: 'four-grid', label: 'Four up',
    frames: [...H2(0, 0.5), ...H2(0.5, 0.5)],
  },
  {
    id: 'six-grid', label: 'Six up',
    frames: [...H2(0, 1 / 3), ...H2(1 / 3, 1 / 3), ...H2(2 / 3, 1 / 3)],
  },
  {
    id: 'hero-two', label: 'Hero over two',
    frames: [{ x: 0, y: 0, w: 1, h: 0.56 }, ...H2(0.56, 0.44)],
  },
  {
    id: 'two-hero', label: 'Two over hero',
    frames: [...H2(0, 0.44), { x: 0, y: 0.44, w: 1, h: 0.56 }],
  },
]

export function layoutOf(id: PageLayoutId): PageLayout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]
}

export function panelCount(id: PageLayoutId): number {
  return layoutOf(id).frames.length
}

export interface PageGeometry {
  width: number
  height: number
  margin: number
  gutter: number
}

/**
 * Turn a layout frame into pixel coordinates. Frames are expressed edge to
 * edge; the gutter is taken out here so panels never touch each other or the
 * page margin, which is what makes a grid read as comic panels.
 */
export function frameToRect(frame: Frame, geo: PageGeometry): { x: number; y: number; w: number; h: number } {
  const liveW = geo.width - geo.margin * 2
  const liveH = geo.height - geo.margin * 2
  const half = geo.gutter / 2
  // Outer edges sit on the margin; inner edges are inset by half a gutter each,
  // so neighbouring panels end up a full gutter apart.
  const left = geo.margin + frame.x * liveW + (frame.x > 0 ? half : 0)
  const top = geo.margin + frame.y * liveH + (frame.y > 0 ? half : 0)
  const right = geo.margin + (frame.x + frame.w) * liveW - (frame.x + frame.w < 0.999 ? half : 0)
  const bottom = geo.margin + (frame.y + frame.h) * liveH - (frame.y + frame.h < 0.999 ? half : 0)
  return { x: left, y: top, w: right - left, h: bottom - top }
}
