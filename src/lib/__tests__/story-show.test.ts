import { describe, expect, it } from 'vitest'
import {
  MAX_SHOW_LENGTH as API_MAX_SHOW_LENGTH, buildChapterPrompt, buildOutlinePrompt, cleanShow,
} from '../../../api/generate-story'
import { MAX_SHOW_LENGTH } from '@/lib/story/limits'
import { readOutline } from '@/lib/story/story'

const CAST = [{ name: 'Rell', look: 'a small red fox in an oilskin coat' }]
const OUTLINE = { title: 'T', cast: CAST, chapters: [{ title: 'One', summary: 'S' }] }

describe('a book from a show or film', () => {
  it('agrees with the form on how long a title may be', () => {
    expect(MAX_SHOW_LENGTH).toBe(API_MAX_SHOW_LENGTH)
    expect(cleanShow('  How   to Train \n Your Dragon ')).toBe('How to Train Your Dragon')
    expect(cleanShow('x'.repeat(400))).toHaveLength(MAX_SHOW_LENGTH)
  })

  it('will plan from a show alone, with no idea of its own', () => {
    const prompt = buildOutlinePrompt('', 'graphic', 'short', 'children', 'Dragon Riders')
    expect(prompt).toContain('set in "Dragon Riders"')
    expect(prompt).toContain('real characters')
  })

  it('tells its own story again, or a new one, as asked', () => {
    expect(buildOutlinePrompt('', 'graphic', 'short', 'children', 'Dragon Riders', true))
      .toContain('own story again')
    expect(buildOutlinePrompt('', 'graphic', 'short', 'children', 'Dragon Riders', false))
      .toContain('new adventure')
  })

  it('still needs something to go on', () => {
    expect(() => buildOutlinePrompt('', 'prose', 'short', 'middle', '   ')).toThrow()
    expect(() => buildOutlinePrompt('  ', 'prose', 'short', 'middle')).toThrow()
  })

  /**
   * An image model refuses or mangles a character asked for by name, so the
   * drawings are made from description — which has to be a true description to
   * be any use at all.
   */
  it('asks how the characters really look, so a drawing can be recognised', () => {
    const prompt = buildOutlinePrompt('a new adventure', 'graphic', 'short', 'children', 'Dragon Riders')
    expect(prompt).toContain('how each character really looks')
    expect(prompt).toContain('be recognised')
    expect(prompt).toContain('"cast"')
  })

  it('says nothing about a show when the story is the writer’s own', () => {
    const prompt = buildOutlinePrompt('a fox at sea', 'prose', 'short', 'middle')
    expect(prompt).not.toContain('world of')
    // The cast is still asked for: it is what keeps the drawings consistent.
    expect(prompt).toContain('"cast"')
  })

  it('carries the cast into every chapter, so the drawings match page to page', () => {
    const prompt = buildChapterPrompt('x', 'graphic', 'short', 'middle', OUTLINE, 0, 'Dragon Riders')
    expect(prompt).toContain('Rell — a small red fox in an oilskin coat')
    expect(prompt).toContain('only by their description from the cast')
  })

  /**
   * The panel brief goes straight to the image model, which refuses a famous
   * name outright — so the brief must carry the description and nothing else.
   */
  it('keeps names, and what they are from, out of the drawing brief', () => {
    const prompt = buildChapterPrompt('x', 'graphic', 'short', 'middle', OUTLINE, 0, 'Dragon Riders')
    expect(prompt).toContain('never by name')
    expect(prompt).toContain('never by naming what they are from')
  })

  it('asks which side of the panel each speaker is on', () => {
    const prompt = buildChapterPrompt('x', 'graphic', 'short', 'middle', OUTLINE, 0)
    expect(prompt).toContain('"from"')
    expect(prompt).toContain('left, middle or right')
    expect(prompt).toContain('"speaker"')
  })

  it('tells a panel to describe who is in it even when there is no cast', () => {
    const prompt = buildChapterPrompt('x', 'graphic', 'short', 'middle', { title: 'T', chapters: [{ title: 'One' }] }, 0)
    expect(prompt).toContain('what they look like every time')
  })

  it('leaves prose chapters alone — only pictures need the descriptions', () => {
    const prompt = buildChapterPrompt('x', 'prose', 'short', 'middle', OUTLINE, 0)
    expect(prompt).toContain('Rell — a small red fox')
    expect(prompt).not.toContain('"art"')
  })
})

describe('reading a cast back', () => {
  it('keeps the named members and drops the empty ones', () => {
    const outline = readOutline({
      title: 'T',
      cast: [{ name: 'Rell', look: 'a red fox' }, { name: '', look: 'nobody' }, null],
      chapters: [{ title: 'One', summary: 'S' }],
    })
    expect(outline.cast).toEqual([{ name: 'Rell', look: 'a red fox' }])
  })

  it('copes with a plan that came back with no cast at all', () => {
    expect(readOutline({ title: 'T', chapters: [{ title: 'One' }] }).cast).toEqual([])
  })
})
