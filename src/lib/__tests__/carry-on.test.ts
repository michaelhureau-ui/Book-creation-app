import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { continueStory, StoryFailed, writeStory } from '@/lib/story/generate'
import { planFromWritten } from '@/lib/story/story'
import { stoppedShort } from '@/lib/story/limits'
import { createBook, createChapter, createProsePage } from '@/lib/book'
import type { Book, Chapter, Page } from '@/types'

function reply(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const CHAPTER = { pages: [{ paragraphs: ['A line of the story.'] }] }

function plan(count: number, from = 0) {
  return {
    outline: {
      title: 'The Lantern',
      chapters: Array.from({ length: count }, (_, i) => ({
        title: `Chapter ${from + i + 1}`,
        summary: 'Something happens.',
      })),
    },
  }
}

/** A book stopped part-way, as the library holds it. */
function halfWritten(chapters: number, withPlan: boolean): Book {
  const book = createBook('The Lantern', '', 'prose')
  book.chapters = Array.from({ length: chapters }, (_, i) => {
    const chapter = createChapter('chapter', `Chapter ${i + 1}`)
    chapter.pages = [createProsePage('<p>Rell climbed the stair again.</p>')]
    return chapter
  })
  if (withPlan) {
    book.writing = {
      idea: 'a fox who keeps a lighthouse',
      show: '', retell: false, audience: 'middle', length: 'short', wanted: 10,
      chapters: Array.from({ length: 10 }, (_, i) => ({ title: `Chapter ${i + 1}`, summary: 'S' })),
      cast: [{ name: 'Rell', look: 'a small red fox' }],
    }
  }
  return book
}

function hooks() {
  const saved: string[] = []
  return {
    saved,
    onProgress: () => {},
    onStart: async (book: Book) => book.id,
    onChapter: (_id: string, chapter: Chapter, _pages: Page[]) => { saved.push(chapter.title) },
  }
}

describe('carrying a half-written book on', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('knows which books stopped short', () => {
    expect(stoppedShort(halfWritten(3, true))).toBe(true)
    const finished = halfWritten(10, true)
    expect(stoppedShort(finished)).toBe(false)
    // A book somebody is typing themselves is never "unfinished".
    expect(stoppedShort(halfWritten(3, false))).toBe(false)
  })

  it('writes only the chapters that are missing, keeping the ones that are there', async () => {
    const asked: { stage: string; index?: number }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}')
      asked.push({ stage: body.stage, index: body.index })
      return body.stage === 'chapter' ? reply({ chapter: CHAPTER }) : reply(plan(10))
    }))

    const h = hooks()
    const run = continueStory(halfWritten(7, true), h)
    await vi.runAllTimersAsync()
    const result = await run

    // Seven were written; three remain, and it starts at the eighth.
    expect(result.chapters).toBe(3)
    expect(asked.filter((a) => a.stage === 'chapter').map((a) => a.index)).toEqual([7, 8, 9])
    expect(h.saved).toEqual(['Chapter 8', 'Chapter 9', 'Chapter 10'])
    // The plan it already had is enough: nothing needed re-planning.
    expect(asked.filter((a) => a.stage === 'outline')).toHaveLength(0)
  })

  it('reads the story back off the page when no plan was kept', async () => {
    let sentSofar: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}')
      if (body.stage === 'chapter') return reply({ chapter: CHAPTER })
      sentSofar = body.sofar ?? []
      return reply(plan(10 - sentSofar.length, sentSofar.length))
    }))

    const h = hooks()
    const run = continueStory(halfWritten(3, false), h, undefined, {
      idea: 'a fox who keeps a lighthouse', length: 'short',
    })
    await vi.runAllTimersAsync()
    const result = await run

    // The three written chapters were handed back as the plan so far, so the
    // model carries on rather than starting the story again.
    expect(sentSofar).toHaveLength(3)
    expect(result.chapters).toBe(7)
    expect(h.saved[0]).toBe('Chapter 4')
  })

  it('rebuilds a rough plan from what is actually on the page', () => {
    const rebuilt = planFromWritten(halfWritten(2, false))
    expect(rebuilt).toHaveLength(2)
    expect(rebuilt[0].title).toBe('Chapter 1')
    // The summary is the writing itself, with the markup taken out.
    expect(rebuilt[0].summary).toBe('Rell climbed the stair again.')
  })

  it('says so rather than working when there is nothing left to write', async () => {
    const run = continueStory(halfWritten(10, true), hooks()).then(() => null, (e) => e)
    await vi.runAllTimersAsync()
    const err = await run
    expect(err).toBeInstanceOf(StoryFailed)
    expect((err as Error).message).toMatch(/already as long as it was meant to be/)
  })

  it('keeps the plan with a new book, so it can be carried on later', async () => {
    let started: Book | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) =>
      (JSON.parse(init?.body ?? '{}').stage === 'chapter' ? reply({ chapter: CHAPTER }) : reply(plan(10)))))

    const run = writeStory('a fox who keeps a lighthouse', 'prose', 'short', 'middle', {
      onProgress: () => {},
      onStart: async (book: Book) => { started = book; return book.id },
      onChapter: () => {},
    })
    await vi.runAllTimersAsync()
    await run

    const saved = started as Book | null
    expect(saved?.writing?.wanted).toBe(10)
    expect(saved?.writing?.idea).toBe('a fox who keeps a lighthouse')
    expect(saved?.writing?.chapters).toHaveLength(10)
  })
})
