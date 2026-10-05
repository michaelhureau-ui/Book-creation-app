import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILM, FRAME_ASPECT, ease, filmSeconds, holdFor, moveFor, panelAspectOf, shotAt, shotList,
} from '@/lib/movie/film'
import { fileExtension, pickMimeType } from '@/lib/movie/record'
import { createBalloon, createPage } from '@/lib/graphic/pages'
import { createBook, createChapter } from '@/lib/book'
import { panelCount } from '@/lib/graphic/layouts'
import type { Book } from '@/types'

function comic(): Book {
  const book = createBook('Deep Water', 'M. Hureau', 'graphic')
  book.subtitle = 'A tale'
  const one = createChapter('chapter', 'The Harbour')
  const two = createChapter('chapter', 'The Crossing')
  book.chapters = [one, two]
  book.pages = [
    createPage('splash', 'a', one.id),
    createPage('two-rows', 'b', one.id),
    createPage('splash', 'c', two.id),
  ]
  return book
}

describe('the shot list', () => {
  it('opens on the cover and closes on an end card', () => {
    const shots = shotList(comic())
    expect(shots[0]).toMatchObject({ kind: 'cover', title: 'Deep Water', subtitle: 'A tale' })
    expect(shots[shots.length - 1].kind).toBe('end')
  })

  it('announces a chapter once, where it begins', () => {
    const chapters = shotList(comic()).filter((s) => s.kind === 'chapter')
    expect(chapters.map((s) => (s.kind === 'chapter' ? s.title : ''))).toEqual(['The Harbour', 'The Crossing'])
  })

  it('moves through every panel of every page', () => {
    const book = comic()
    const shots = shotList(book, { ...DEFAULT_FILM, motion: 'panels' })
    const panels = shots.filter((s) => s.kind === 'panel')
    const expected = book.pages.reduce((n, page) => n + panelCount(page.layout), 0)
    expect(panels).toHaveLength(expected)
  })

  it('holds whole pages instead when asked', () => {
    const shots = shotList(comic(), { ...DEFAULT_FILM, motion: 'pages' })
    expect(shots.filter((s) => s.kind === 'page')).toHaveLength(3)
    expect(shots.filter((s) => s.kind === 'panel')).toHaveLength(0)
  })

  /** A page read aloud takes longer than a page glanced at. */
  it('gives a talkative panel longer than a silent one', () => {
    const quiet = holdFor(2.6, [])
    const talkative = holdFor(2.6, [
      { ...createBalloon('speech'), text: 'I have been waiting on this corner since the rain started.' },
    ])
    expect(talkative).toBeGreaterThan(quiet)
    // But no panel may hold the film up for ever.
    expect(holdFor(2.6, [{ ...createBalloon('speech'), text: 'word '.repeat(400) }]))
      .toBeLessThanOrEqual(2.6 * 3)
  })

  it('makes a title sequence for a novel, which has no pictures to film', () => {
    const book = createBook('Prose', 'M. Hureau')
    book.chapters = [createChapter('chapter', 'One'), createChapter('chapter', 'Two')]
    const kinds = shotList(book).map((s) => s.kind)
    expect(kinds).toEqual(['cover', 'chapter', 'chapter', 'end'])
  })

  it('still makes something of a book with nothing in it', () => {
    const shots = shotList(createBook('Empty', '', 'graphic'))
    expect(shots.map((s) => s.kind)).toEqual(['cover', 'end'])
    expect(filmSeconds(shots)).toBeGreaterThan(0)
  })

  it('never lets a slower pace make a shorter film', () => {
    const book = comic()
    const quick = filmSeconds(shotList(book, { motion: 'panels', pace: 1.8 }))
    const slow = filmSeconds(shotList(book, { motion: 'panels', pace: 3.8 }))
    expect(slow).toBeGreaterThan(quick)
  })
})

describe('finding the frame to draw', () => {
  const shots = shotList(comic())

  it('runs from the first shot to the last without a gap', () => {
    expect(shotAt(shots, 0)?.shot.kind).toBe('cover')
    const total = filmSeconds(shots)
    for (let t = 0; t < total; t += total / 40) {
      expect(shotAt(shots, t)).not.toBeNull()
    }
    expect(shotAt(shots, total)).toBeNull()
  })

  it('reports how far through a shot the clock is', () => {
    const first = shots[0]
    expect(shotAt(shots, 0)?.progress).toBeCloseTo(0)
    expect(shotAt(shots, first.seconds * 0.5)?.progress).toBeCloseTo(0.5)
  })

  it('eases in and out rather than snapping into motion', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBeCloseTo(0.5)
    // Gentle at the start: a tenth of the way through is less than a tenth of the move.
    expect(ease(0.1)).toBeLessThan(0.1)
    expect(ease(-5)).toBe(0)
    expect(ease(5)).toBe(1)
  })
})

describe('the file the browser can record', () => {
  it('prefers webm, and takes mp4 where that is all there is', () => {
    expect(pickMimeType((type) => type === 'video/webm;codecs=vp9')).toBe('video/webm;codecs=vp9')
    expect(pickMimeType((type) => type === 'video/mp4')).toBe('video/mp4')
    expect(pickMimeType(() => false)).toBeNull()
  })

  it('names the file after what is actually inside it', () => {
    expect(fileExtension('video/mp4')).toBe('mp4')
    expect(fileExtension('video/webm;codecs=vp9')).toBe('webm')
  })
})

describe('how the camera travels over a picture', () => {
  /**
   * A panel is cropped to fill a wide screen, so a tall one held dead centre
   * loses its top and bottom — on a comic page, usually somebody's head.
   */
  it('travels down a tall panel instead of cropping to its middle', () => {
    const move = moveFor(0, FRAME_ASPECT * 0.4)
    expect(move.from.y).toBeLessThan(move.to.y)
    expect(move.to.y - move.from.y).toBeGreaterThan(0.4)
  })

  it('travels across a very wide one, and turns round on the next shot', () => {
    const first = moveFor(0, FRAME_ASPECT * 3)
    const second = moveFor(1, FRAME_ASPECT * 3)
    expect(first.from.x).toBeLessThan(first.to.x)
    expect(second.from.x).toBeGreaterThan(second.to.x)
  })

  it('merely pushes in on a picture already the shape of the screen', () => {
    const move = moveFor(0, FRAME_ASPECT)
    expect(move.to.scale).toBeGreaterThan(move.from.scale)
    expect(Math.abs(move.to.y - move.from.y)).toBeLessThan(0.01)
  })

  it('reads a panel’s shape from the layout it sits in', () => {
    const splash = createPage('splash', 'a', null)
    const columns = createPage('three-columns', 'b', null)
    // A whole comic page is tall; one of three columns is far taller again.
    expect(panelAspectOf(splash, 0)).toBeLessThan(FRAME_ASPECT)
    expect(panelAspectOf(columns, 0)).toBeLessThan(panelAspectOf(splash, 0))
    // An index that is not there falls back rather than dividing by nothing.
    expect(panelAspectOf(splash, 9)).toBe(FRAME_ASPECT)
  })
})
