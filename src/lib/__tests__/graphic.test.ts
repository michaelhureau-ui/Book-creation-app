import { describe, expect, it } from 'vitest'
import { applyLayout, createBalloon, createPage, orphanedAssets, remapAssets } from '@/lib/graphic/pages'
import { frameToRect, layoutOf, LAYOUTS, panelCount } from '@/lib/graphic/layouts'
import { sourceRect } from '@/lib/graphic/render'
import { bookFromJson } from '@/lib/export'
import { bookStats } from '@/lib/stats'
import { createBook } from '@/lib/book'
import { panelAspect, panelRects } from '@/components/graphic/geometry'
import type { Page } from '@/types'

describe('layouts', () => {
  it('gives every layout at least one frame, all inside the page', () => {
    for (const layout of LAYOUTS) {
      expect(layout.frames.length).toBeGreaterThan(0)
      for (const f of layout.frames) {
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.y).toBeGreaterThanOrEqual(0)
        expect(f.x + f.w).toBeLessThanOrEqual(1.001)
        expect(f.y + f.h).toBeLessThanOrEqual(1.001)
      }
    }
  })

  it('covers the whole page area with no overlap', () => {
    for (const layout of LAYOUTS) {
      const area = layout.frames.reduce((sum, f) => sum + f.w * f.h, 0)
      expect(area).toBeCloseTo(1, 5)
    }
  })

  it('keeps panels inside the margins and a gutter apart', () => {
    const geo = { width: 1000, height: 1500, margin: 45, gutter: 22 }
    const rects = layoutOf('four-grid').frames.map((f) => frameToRect(f, geo))
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(geo.margin - 0.01)
      expect(r.y).toBeGreaterThanOrEqual(geo.margin - 0.01)
      expect(r.x + r.w).toBeLessThanOrEqual(geo.width - geo.margin + 0.01)
      expect(r.y + r.h).toBeLessThanOrEqual(geo.height - geo.margin + 0.01)
      expect(r.w).toBeGreaterThan(0)
      expect(r.h).toBeGreaterThan(0)
    }
    // Left column's right edge to right column's left edge is one full gutter.
    expect(rects[1].x - (rects[0].x + rects[0].w)).toBeCloseTo(geo.gutter, 5)
    expect(rects[2].y - (rects[0].y + rects[0].h)).toBeCloseTo(geo.gutter, 5)
  })
})

describe('createPage', () => {
  it('builds exactly as many panels as the layout needs', () => {
    for (const layout of LAYOUTS) {
      expect(createPage(layout.id).panels).toHaveLength(panelCount(layout.id))
    }
  })
})

describe('applyLayout', () => {
  it('keeps existing artwork when growing the grid', () => {
    const page = createPage('two-rows')
    page.panels[0].assetId = 'art-1'
    const next = applyLayout(page, 'six-grid')
    expect(next.panels).toHaveLength(6)
    expect(next.panels[0].assetId).toBe('art-1')
    expect(next.panels[5].assetId).toBeNull()
  })

  it('drops the surplus panels when shrinking', () => {
    const page = createPage('six-grid')
    page.panels[5].assetId = 'art-6'
    const next = applyLayout(page, 'splash')
    expect(next.panels).toHaveLength(1)
  })
})

describe('orphanedAssets', () => {
  it('only reports artwork nothing references any more', () => {
    const page = createPage('two-rows')
    page.panels[0].assetId = 'keep'
    expect(orphanedAssets([page], ['gone'])).toEqual(['gone'])
    // Still in use elsewhere on the page, so it must not be deleted.
    expect(orphanedAssets([page], ['keep'])).toEqual([])
  })
})

describe('remapAssets', () => {
  it('rewrites ids through the map and leaves the rest alone', () => {
    const page = createPage('two-rows')
    page.panels[0].assetId = 'old'
    page.panels[1].assetId = 'other'
    const [remapped] = remapAssets([page], new Map([['old', 'new']]))
    expect(remapped.panels[0].assetId).toBe('new')
    expect(remapped.panels[1].assetId).toBe('other')
  })

  it('is a no-op for an empty map', () => {
    const pages: Page[] = [createPage('splash')]
    expect(remapAssets(pages, new Map())).toBe(pages)
  })
})

describe('sourceRect', () => {
  const rect = { x: 0, y: 0, w: 400, h: 300 }

  it('cover-fits a wide image, cropping the sides', () => {
    const image = { naturalWidth: 1600, naturalHeight: 600 }
    const { sx, sw, sh } = sourceRect(
      { id: 'p', assetId: 'a', zoom: 1, offsetX: 0, offsetY: 0, balloons: [] }, image, rect)
    // Height is the limiting edge, so the full height is used and width is cropped.
    expect(sh).toBeCloseTo(600, 3)
    expect(sw).toBeLessThan(1600)
    expect(sx).toBeGreaterThan(0)
  })

  it('never samples outside the image, at any zoom or pan', () => {
    const image = { naturalWidth: 900, naturalHeight: 1200 }
    for (const zoom of [1, 1.5, 3]) {
      for (const offset of [-1, -0.3, 0, 0.7, 1]) {
        const r = sourceRect(
          { id: 'p', assetId: 'a', zoom, offsetX: offset, offsetY: offset, balloons: [] }, image, rect)
        expect(r.sx).toBeGreaterThanOrEqual(0)
        expect(r.sy).toBeGreaterThanOrEqual(0)
        expect(r.sx + r.sw).toBeLessThanOrEqual(image.naturalWidth + 1e-6)
        expect(r.sy + r.sh).toBeLessThanOrEqual(image.naturalHeight + 1e-6)
      }
    }
  })

  it('crops tighter as zoom increases', () => {
    const image = { naturalWidth: 900, naturalHeight: 1200 }
    const base = sourceRect({ id: 'p', assetId: 'a', zoom: 1, offsetX: 0, offsetY: 0, balloons: [] }, image, rect)
    const zoomed = sourceRect({ id: 'p', assetId: 'a', zoom: 2, offsetX: 0, offsetY: 0, balloons: [] }, image, rect)
    expect(zoomed.sw).toBeLessThan(base.sw)
    expect(zoomed.sh).toBeLessThan(base.sh)
  })
})

describe('createBalloon', () => {
  it('places a tail away from the balloon body for the kinds that have one', () => {
    for (const kind of ['speech', 'thought', 'shout'] as const) {
      const b = createBalloon(kind)
      expect(Math.hypot(b.tailX - b.x, b.tailY - b.y)).toBeGreaterThan(0.1)
    }
  })
})

describe('graphic novel stats', () => {
  it('counts pages, panels, placed artwork, and lettering words', () => {
    const book = createBook('Comic', 'A', 'graphic')
    const page = createPage('two-rows')
    page.panels[0].assetId = 'art'
    page.panels[0].balloons = [{ ...createBalloon('speech'), text: 'four words go here' }]
    book.pages = [page]
    const stats = bookStats(book)
    expect(stats.pages).toBe(1)
    expect(stats.panels).toBe(2)
    expect(stats.artworkPlaced).toBe(1)
    expect(stats.words).toBe(4)
  })
})

describe('importing a graphic novel backup', () => {
  it('restores pages and pads panels to match the layout', () => {
    const restored = bookFromJson(JSON.stringify({
      title: 'Comic', kind: 'graphic', chapters: [],
      pages: [{ id: 'p1', title: 'One', layout: 'four-grid', panels: [{ assetId: 'a', zoom: 2 }] }],
    }))
    expect(restored.kind).toBe('graphic')
    expect(restored.pages).toHaveLength(1)
    expect(restored.pages[0].panels).toHaveLength(4)
    expect(restored.pages[0].panels[0]).toMatchObject({ assetId: 'a', zoom: 2 })
    expect(restored.pages[0].panels[3].assetId).toBeNull()
  })

  it('falls back to a safe layout and balloon kind for unknown values', () => {
    const restored = bookFromJson(JSON.stringify({
      title: 'Comic', kind: 'graphic', chapters: [],
      pages: [{ layout: 'nonsense', panels: [{ balloons: [{ kind: 'wat', text: 'hi' }] }] }],
    }))
    expect(restored.pages[0].layout).toBe('four-grid')
    expect(restored.pages[0].panels[0].balloons[0].kind).toBe('speech')
  })

  it('still reads a prose backup that predates graphic novels', () => {
    const restored = bookFromJson(JSON.stringify({
      title: 'Old', chapters: [{ title: 'One', content: '<p>hi</p>' }],
    }))
    expect(restored.kind).toBe('prose')
    expect(restored.pages).toEqual([])
    expect(restored.chapters).toHaveLength(1)
  })
})

describe('panelAspect', () => {
  it('reports a splash panel as roughly the page shape', () => {
    const page = createPage('splash')
    // The live area is inset by equal margins, so it keeps the trim's proportions.
    expect(panelAspect(page, 0, 'comic')).toBeCloseTo(6.625 / 10.25, 1)
  })

  it('makes a three-column panel far taller than it is wide', () => {
    const page = createPage('three-columns')
    expect(panelAspect(page, 0, 'comic')).toBeLessThan(0.4)
  })

  it('makes a two-row panel wider than it is tall on a comic page', () => {
    const page = createPage('two-rows')
    expect(panelAspect(page, 0, 'comic')).toBeGreaterThan(1)
  })

  it('falls back to a square for a panel index the layout does not have', () => {
    expect(panelAspect(createPage('splash'), 9, 'comic')).toBe(1)
  })

  it('agrees with the panel rectangles it is derived from', () => {
    const page = createPage('four-grid')
    const rects = panelRects(page, 'comic')
    const pageAspect = 6.625 / 10.25
    for (let i = 0; i < rects.length; i++) {
      const expected = (rects[i].width * pageAspect) / rects[i].height
      expect(panelAspect(page, i, 'comic')).toBeCloseTo(expected, 6)
    }
  })
})
