import { describe, expect, it } from 'vitest'
import { createScore, noteAt } from '@/lib/movie/sound'
import { createNarrator, linesFor, speechSupported } from '@/lib/movie/narrator'
import { shotList } from '@/lib/movie/film'
import { createBalloon } from '@/lib/graphic/pages'
import { createBook, createChapter } from '@/lib/book'
import { createPage } from '@/lib/graphic/pages'
import type { Shot } from '@/lib/movie/film'

describe('the score', () => {
  /** A pentatonic cannot land on a sour chord however the shots fall. */
  it('stays on its scale, rising by the octave', () => {
    expect(noteAt(0)).toBeCloseTo(146.83, 1)
    expect(noteAt(5) / noteAt(0)).toBeCloseTo(2, 2)
    expect(noteAt(-1)).toBeGreaterThan(0)
    for (let step = -10; step < 20; step++) expect(Number.isFinite(noteAt(step))).toBe(true)
  })

  /** jsdom has no audio, and a film should still be made rather than refused. */
  it('falls silent rather than failing where there is no audio', async () => {
    const score = createScore()
    expect(score.tracks).toEqual([])
    const shots = shotList(createBook('Quiet', '', 'graphic'))
    for (const [i, shot] of shots.entries()) expect(() => score.cue(shot, i)).not.toThrow()
    await expect(score.stop()).resolves.toBeUndefined()
  })
})

describe('what the voice reads', () => {
  function comic() {
    const book = createBook('Deep Water', 'M. Hureau', 'graphic')
    book.subtitle = 'A tale'
    const chapter = createChapter('chapter', 'The Harbour')
    book.chapters = [chapter]
    const page = createPage('splash', 'a', chapter.id)
    page.panels[0].balloons = [
      { ...createBalloon('caption'), text: 'Later that night.' },
      { ...createBalloon('speech'), text: 'Nobody came.', speaker: 'Rell' },
      { ...createBalloon('sfx'), text: 'Krakoom' },
      { ...createBalloon('speech'), text: '   ' },
    ]
    book.pages = [page]
    return book
  }

  const shots = shotList(comic())
  const find = (kind: Shot['kind']): Shot => shots.find((s) => s.kind === kind)!

  it('reads the title, the byline and each chapter', () => {
    expect(linesFor(find('cover'))).toEqual(['Deep Water', 'A tale', 'by M. Hureau'])
    expect(linesFor(find('chapter'))).toEqual(['Chapter 1. The Harbour'])
    expect(linesFor(find('end'))).toEqual(['The end.'])
  })

  it('names who speaks, and does not read the stage directions aloud', () => {
    const lines = linesFor(find('panel'))
    expect(lines).toContain('Rell says, Nobody came.')
    // A caption and a sound effect are read as they are, not labelled.
    expect(lines).toContain('Later that night.')
    expect(lines).toContain('Krakoom')
    expect(lines.join(' ')).not.toContain('SPEECH')
    // Nothing is said for a balloon with nothing in it.
    expect(lines).toHaveLength(3)
  })

  it('says nothing over a shot with nothing to say', () => {
    const quiet = createBook('Quiet', '', 'graphic')
    quiet.pages = [createPage('splash', 'a', null)]
    const panel = shotList(quiet).find((s) => s.kind === 'panel')!
    expect(linesFor(panel)).toEqual([])
  })

  it('does nothing at all when it is switched off, or cannot speak', () => {
    const narrator = createNarrator(false)
    expect(() => narrator.speak(find('cover'))).not.toThrow()
    expect(() => narrator.cancel()).not.toThrow()
    // jsdom has no speech synthesis, so the feature reports itself unavailable.
    expect(speechSupported()).toBe(false)
    expect(() => createNarrator(true).speak(find('cover'))).not.toThrow()
  })
})
