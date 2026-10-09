import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OUTLINE_BATCH, SHAPES, buildChapterPrompt, buildOutlinePrompt, pagesIn,
} from '../../../api/generate-story'
import { drawPanels } from '@/lib/story/generate'
import { GenerationFailed } from '@/lib/graphic/generate'
import { createBook } from '@/lib/book'
import { createPage, createPanel } from '@/lib/graphic/pages'
import type { Book } from '@/types'

vi.mock('@/lib/graphic/assets', () => ({
  saveDrawing: vi.fn(async () => ({ id: 'asset', width: 1, height: 1, bytes: 1 })),
}))

/**
 * Generation measures each picture through an `Image`, which jsdom never
 * loads — so without this every panel waits out the four-second measuring
 * timeout. Standing one in lets the drawing logic be tested at its own speed.
 */
beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  vi.stubGlobal('Image', class {
    naturalWidth = 1024
    naturalHeight = 1536
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('how long a book is', () => {
  it('offers a novel at about fifty, a hundred and two hundred pages', () => {
    expect(pagesIn('prose', 'short')).toBe(50)
    expect(pagesIn('prose', 'medium')).toBe(100)
    expect(pagesIn('prose', 'long')).toBe(200)
  })

  it('offers a graphic novel the lengths comics are actually printed at', () => {
    // An issue, a collection, a graphic novel — a 200-page comic is not a thing.
    expect(pagesIn('graphic', 'short')).toBe(24)
    expect(pagesIn('graphic', 'medium')).toBe(64)
    expect(pagesIn('graphic', 'long')).toBe(120)
  })

  /**
   * A chapter is one call, and a call has to finish inside the function's
   * ceiling. Reaching two hundred pages through a handful of enormous chapters
   * would time out — and would lose everything when it did.
   */
  it('reaches the page count with many small chapters', () => {
    for (const kind of ['prose', 'graphic'] as const) {
      for (const length of ['short', 'medium', 'long'] as const) {
        expect(SHAPES[kind][length].pages).toBeLessThanOrEqual(8)
        expect(SHAPES[kind][length].chapters).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it('asks the plan and each chapter for the counts the length means', () => {
    // The whole length is stated, but only the first batch is asked for: forty
    // chapter summaries in one go outlast the function.
    expect(buildOutlinePrompt('a fox', 'prose', 'long', 'middle'))
      .toContain(`The whole book has ${SHAPES.prose.long.chapters} chapters`)
    expect(buildOutlinePrompt('a fox', 'prose', 'long', 'middle'))
      .toContain(`plan only the first ${OUTLINE_BATCH} of them now`)
    const outline = { title: 'T', chapters: [{ title: 'One', summary: 'S' }] }
    expect(buildChapterPrompt('a fox', 'prose', 'long', 'middle', outline, 0))
      .toContain(`as ${SHAPES.prose.long.pages} pages`)
  })
})

describe('drawing the panels of a written comic', () => {
  function comic(notes: (string | null)[]): Book {
    const book = createBook('Drawn', '', 'graphic')
    book.id = 'book-1'
    const page = createPage('four-grid', 'Page 1', null)
    page.panels = notes.map((note) => ({ ...createPanel(), note: note ?? undefined }))
    book.pages = [page]
    return book
  }

  it('draws only the panels that say what they show', async () => {
    const book = comic(['a fox', null, '   ', 'a bus'])
    const placed: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ image: 'aGk=', mime: 'image/png' }),
    } as unknown as Response)))
    const result = await drawPanels(book, 'color', (_p, panelId) => placed.push(panelId), () => {})
    expect(result).toMatchObject({ drawn: 2, total: 2 })
    expect(placed).toHaveLength(2)
  })

  it('stops the moment the allowance runs out, and keeps what it drew', async () => {
    const book = comic(['one', 'two', 'three', 'four'])
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls > 1) {
        return {
          ok: false, status: 429,
          json: async () => ({ error: { code: 'quota', message: 'Out of credit.' } }),
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ image: 'aGk=', mime: 'image/png' }) } as unknown as Response
    }))
    const result = await drawPanels(book, 'color', () => {}, () => {})
    expect(result.drawn).toBe(1)
    expect(result.stopped).toContain('Out of credit')
    // It must not keep asking after the allowance is gone.
    expect(calls).toBe(2)
  })

  it('skips one picture the model would not draw and carries on', async () => {
    const book = comic(['one', 'two', 'three'])
    // The second panel is refused however it is worded, so the nameless retry
    // does not rescue it either — what is under test is carrying on past it.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
      if (/two/.test(JSON.parse(init?.body ?? '{}').subject ?? '')) {
        return {
          ok: false, status: 400,
          json: async () => ({ error: { code: 'rejected', message: 'Would not draw that.' } }),
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ image: 'aGk=', mime: 'image/png' }) } as unknown as Response
    }))
    const result = await drawPanels(book, 'color', () => {}, () => {})
    expect(result).toMatchObject({ drawn: 2, total: 3, failed: 1 })
    expect(result.stopped).toBeUndefined()
  })

  it('stops when told to, without drawing the rest', async () => {
    const book = comic(['one', 'two', 'three'])
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort()
      return { ok: true, status: 200, json: async () => ({ image: 'aGk=', mime: 'image/png' }) } as unknown as Response
    }))
    const result = await drawPanels(book, 'color', () => {}, () => {}, controller.signal)
    expect(result.drawn).toBeLessThan(3)
    expect(result.stopped).toBe('You stopped it.')
  })

  it('reports nothing to do when no panel says what it shows', async () => {
    const result = await drawPanels(comic([null, null, null, null]), 'color', () => {}, () => {})
    expect(result).toMatchObject({ drawn: 0, total: 0 })
  })
})

describe('GenerationFailed', () => {
  it('carries the code the drawing pass decides on', () => {
    expect(new GenerationFailed({ code: 'quota', message: 'x' }).code).toBe('quota')
  })
})
