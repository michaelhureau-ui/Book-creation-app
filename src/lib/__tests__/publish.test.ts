import { describe, expect, it } from 'vitest'
import { comicPageBox } from '@/lib/export/comic'
import { BLEED_IN, MARKS_IN, TRIMS, trimOf } from '@/lib/graphic/render'

/** Points per inch, the unit a PDF page is measured in. */
const PT = 72

describe('the page a graphic novel is published at', () => {
  it('offers the sizes comics are actually printed at', () => {
    expect(trimOf('comic')).toMatchObject({ width: 6.625, height: 10.25 })
    expect(trimOf('trade')).toMatchObject({ width: 6.75, height: 10.5 })
    expect(trimOf('manga')).toMatchObject({ width: 5, height: 7.5 })
    // Every size has to be taller than it is wide, or it is not a comic page.
    for (const trim of TRIMS.filter((t) => t.id !== 'square')) {
      expect(trim.height).toBeGreaterThan(trim.width)
    }
  })

  it('fills the page exactly when the book is only going to be read on a screen', () => {
    const box = comicPageBox('comic', false)
    expect(box.width).toBeCloseTo(6.625 * PT)
    expect(box.height).toBeCloseTo(10.25 * PT)
    // No margin and no overhang: what you see is the whole page.
    expect(box.artX).toBe(0)
    expect(box.artY).toBe(0)
    expect(box.artWidth).toBeCloseTo(box.width)
    expect(box.artHeight).toBeCloseTo(box.height)
  })

  it('runs the artwork past the cut and leaves room for crop marks when printing', () => {
    const box = comicPageBox('comic', true)
    const pad = (BLEED_IN + MARKS_IN) * PT

    // The paper is bigger than the finished page by the bleed and the marks.
    expect(box.width).toBeCloseTo(6.625 * PT + pad * 2)
    expect(box.height).toBeCloseTo(10.25 * PT + pad * 2)
    // The finished page is still the trim size — that is what gets cut.
    expect(box.trimWidth).toBeCloseTo(6.625 * PT)
    expect(box.trimHeight).toBeCloseTo(10.25 * PT)
    // Artwork overhangs the trim line by the bleed on every side, so a
    // mis-cut of a hair shows more drawing rather than white paper.
    expect(box.artWidth - box.trimWidth).toBeCloseTo(BLEED_IN * 2 * PT)
    expect(box.artHeight - box.trimHeight).toBeCloseTo(BLEED_IN * 2 * PT)
    expect(box.artX).toBeCloseTo(MARKS_IN * PT)
    expect(box.pad).toBeCloseTo(pad)
  })

  it('keeps the proportions of the page it is printing, whatever the size', () => {
    for (const trim of TRIMS) {
      const box = comicPageBox(trim.id, true)
      expect(box.trimWidth / box.trimHeight).toBeCloseTo(trim.width / trim.height, 5)
    }
  })
})
