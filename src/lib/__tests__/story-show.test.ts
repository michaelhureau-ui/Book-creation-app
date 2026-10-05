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
    expect(prompt).toContain('world of "Dragon Riders"')
  })

  it('still needs something to go on', () => {
    expect(() => buildOutlinePrompt('', 'prose', 'short', 'middle', '   ')).toThrow()
    expect(() => buildOutlinePrompt('  ', 'prose', 'short', 'middle')).toThrow()
  })

  /**
   * Writing a story set in a show is ordinary play; copying its artwork is not,
   * and an image model will refuse a named character anyway. So the plan is
   * asked for its own descriptions, and those are what the panels are drawn
   * from.
   */
  it('asks for the cast in plain words rather than by how the real one is drawn', () => {
    const prompt = buildOutlinePrompt('a new adventure', 'graphic', 'short', 'children', 'Dragon Riders')
    expect(prompt).toContain('in your own plain words')
    expect(prompt).toContain('"cast"')
    expect(prompt).toContain('new story of our own')
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
    expect(prompt).toContain('repeat their description from the cast')
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
