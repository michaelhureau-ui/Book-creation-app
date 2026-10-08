import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHAPES, looksLikeWrongModel, refusalAdvice } from '../../../api/generate-story'
import { StoryFailed, writeStory } from '@/lib/story/generate'
import { CHAPTERS_IN } from '@/lib/story/limits'

/**
 * A 200-page book came back 5 pages long with nothing said about it. Three
 * separate things conspired: an overloaded model ended the walk, a chapter
 * failing mid-book ended the loop in silence, and a short plan made a short
 * book without comment.
 */
function reply(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const CHAPTER = { pages: [{ paragraphs: ['A line of the story.'] }] }

function hooks() {
  const chapters: string[] = []
  return {
    saved: chapters,
    onProgress: () => {},
    onStart: async () => 'book-1',
    onChapter: (_id: string, chapter: { title: string }) => { chapters.push(chapter.title) },
  }
}

function plan(count: number) {
  return {
    outline: {
      title: 'The Lamp',
      chapters: Array.from({ length: count }, (_, i) => ({ title: `Chapter ${i + 1}`, summary: 'S' })),
    },
  }
}

describe('the length a book actually comes out', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('mirrors the endpoint chapter counts, so a short plan can be spotted', () => {
    for (const length of ['short', 'medium', 'long'] as const) {
      expect(CHAPTERS_IN[length]).toBe(SHAPES.prose[length].chapters)
    }
  })

  it('keeps writing after a chapter fails once, rather than losing the rest', async () => {
    let asks = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      asks++
      if (asks === 1) return reply(plan(10))
      // The second chapter is refused the first time it is asked for.
      if (asks === 3) return reply({ error: { code: 'provider_error', message: 'busy' } }, 503)
      return reply({ chapter: CHAPTER })
    }))

    const h = hooks()
    const writing = writeStory('a fox', 'prose', 'short', 'middle', h)
    await vi.runAllTimersAsync()
    const result = await writing
    expect(result.chapters).toBe(10)
    expect(h.saved[1]).toBe('Chapter 2')
  })

  it('says where it stopped instead of handing back a short book in silence', async () => {
    let asks = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      asks++
      if (asks === 1) return reply(plan(10))
      if (asks === 2) return reply({ chapter: CHAPTER })
      return reply({ error: { code: 'provider_error', message: 'the service failed' } }, 503)
    }))

    const h = hooks()
    // Settled either way before the timers run, so a rejection is never loose.
    const writing = writeStory('a fox', 'prose', 'short', 'middle', h).then(() => null, (e) => e)
    await vi.runAllTimersAsync()
    const err = await writing
    expect(err).toBeInstanceOf(StoryFailed)
    expect((err as Error).message).toMatch(/stopped at chapter 2 of 10/)
    // What was written is still saved; only the silence was the bug.
    expect(h.saved).toEqual(['Chapter 1'])
  })

  it('complains when the plan is shorter than the book that was asked for', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) =>
      JSON.parse(init?.body ?? '{}').stage === 'chapter'
        ? reply({ chapter: CHAPTER })
        : reply(plan(1))))

    const h = hooks()
    const writing = writeStory('a fox', 'prose', 'long', 'middle', h).then(() => null, (e) => e)
    await vi.runAllTimersAsync()
    const err = await writing
    expect(err).toBeInstanceOf(StoryFailed)
    expect((err as Error).message).toMatch(/only came back with 1 chapter instead of 40/)
    expect((err as Error).message).toMatch(/5 pages rather than 200/)
  })

  it('treats a busy model as a reason to try the next one, not to give up', () => {
    expect(looksLikeWrongModel(503, 'This model is currently experiencing high demand.')).toBe(true)
    expect(refusalAdvice(4, ['This model is currently experiencing high demand.']))
      .toContain('busy right now')
    // Being busy is not being broke, and the advice must not confuse the two.
    expect(refusalAdvice(4, ['This model is currently experiencing high demand.']))
      .not.toContain('run out of credit')
  })
})
