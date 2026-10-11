import { describe, expect, it } from 'vitest'
import {
  LETTERED_SPINE_IN, PAPER_STOCKS, pageCountOf, spineInches, stockOf, wrapBox,
} from '@/lib/export/wrap'
import { BLEED_IN, MARKS_IN, trimOf } from '@/lib/graphic/render'
import { createBook, createChapter, createProsePage } from '@/lib/book'
import { createPage } from '@/lib/graphic/pages'

describe('how wide the spine has to be', () => {
  it('is half the page count times the thickness of a leaf', () => {
    // 64 pages is 32 leaves of paper.
    expect(spineInches(64, 'standard')).toBeCloseTo(32 * 0.0045, 6)
  })

  it('is thicker on thicker paper', () => {
    expect(spineInches(64, 'thick')).toBeGreaterThan(spineInches(64, 'standard'))
    expect(spineInches(64, 'thin')).toBeLessThan(spineInches(64, 'standard'))
  })

  it('rounds an odd page count up to a whole leaf', () => {
    expect(spineInches(65, 'standard')).toBeCloseTo(spineInches(66, 'standard'), 6)
  })

  it('is nothing at all for a book with no pages', () => {
    expect(spineInches(0)).toBe(0)
    expect(spineInches(Number.NaN)).toBe(0)
    expect(spineInches(-20)).toBe(0)
  })

  it('a thin comic comes out too narrow to letter', () => {
    // A 24-page comic is stapled, not bound; its spine is a fold.
    expect(spineInches(24)).toBeLessThan(LETTERED_SPINE_IN)
    // A 200-page book is a real spine with room for the title.
    expect(spineInches(200)).toBeGreaterThan(LETTERED_SPINE_IN)
  })

  it('knows every paper it offers', () => {
    for (const stock of PAPER_STOCKS) expect(stockOf(stock.id).leaf).toBeGreaterThan(0)
  })
})

describe('the sheet the jacket is printed on', () => {
  it('is two covers and a spine across, and one cover tall', () => {
    const trim = trimOf('comic')
    const box = wrapBox('comic', 64, 'standard', false)
    expect(box.trimWidth).toBeCloseTo((trim.width * 2 + spineInches(64)) * 72, 4)
    expect(box.trimHeight).toBeCloseTo(trim.height * 72, 4)
    // Nothing to trim off when it is not going to a press.
    expect(box.width).toBeCloseTo(box.trimWidth, 4)
    expect(box.pad).toBe(0)
  })

  it('carries bleed and room for crop marks when it is print-ready', () => {
    const box = wrapBox('comic', 64, 'standard', true)
    expect(box.pad).toBeCloseTo((BLEED_IN + MARKS_IN) * 72, 4)
    expect(box.width).toBeCloseTo(box.trimWidth + box.pad * 2, 4)
    // The artwork runs a bleed past the cut on every side.
    expect(box.artWidth).toBeCloseTo(box.trimWidth + BLEED_IN * 72 * 2, 4)
    expect(box.artX).toBeCloseTo(box.pad - BLEED_IN * 72, 4)
  })

  it('puts the back cover, the spine and the front in reading order', () => {
    const box = wrapBox('trade', 120, 'standard', true)
    expect(box.backX).toBeLessThan(box.spineX)
    expect(box.spineX).toBeLessThan(box.frontX)
    expect(box.spineX + box.spineWidth).toBeCloseTo(box.frontX, 6)
    expect(box.frontX + box.coverWidth).toBeCloseTo(box.pad + box.trimWidth, 6)
  })

  it('still makes a sheet for a book with no pages in it yet', () => {
    const box = wrapBox('comic', 0, 'standard', true)
    expect(box.spineWidth).toBe(0)
    expect(box.trimWidth).toBeCloseTo(trimOf('comic').width * 2 * 72, 4)
  })
})

describe('how many pages the book has', () => {
  it('counts the drawn pages of a comic', () => {
    const book = createBook('Comic', '', 'graphic')
    expect(pageCountOf({ ...book, pages: [createPage('two-rows'), createPage('two-rows')] })).toBe(2)
  })

  it('counts the pages of every chapter of a novel', () => {
    const book = createBook('Novel', '', 'prose')
    const chapter = { ...createChapter('chapter', 'One'), pages: [createProsePage(), createProsePage()] }
    expect(pageCountOf({ ...book, chapters: [chapter, chapter] })).toBe(4)
  })
})
