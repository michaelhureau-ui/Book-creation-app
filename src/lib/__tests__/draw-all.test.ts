import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drawPanels } from '@/lib/story/generate'
import { createBook } from '@/lib/book'
import { createPage, createPanel } from '@/lib/graphic/pages'
import type { Book } from '@/types'

vi.mock('@/lib/graphic/assets', () => ({
  saveDrawing: vi.fn(async () => ({ id: `asset-${Math.random()}`, width: 1, height: 1, bytes: 1 })),
}))

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  vi.stubGlobal('Image', class {
    naturalWidth = 1024
    naturalHeight = 1536
    onload: (() => void) | null = null
    set src(_v: string) { queueMicrotask(() => this.onload?.()) }
  })
})
afterEach(() => vi.unstubAllGlobals())

/** A written comic: every panel has a brief, some are already drawn. */
function comic(pages: number, alreadyDrawn: number): Book {
  const book = createBook('The Ashfall Alliance', '', 'graphic')
  let drawn = 0
  book.pages = Array.from({ length: pages }, () => {
    const page = createPage()
    page.panels = [createPanel(), createPanel()].map((panel) => {
      panel.note = 'A fox on a lighthouse stair.'
      if (drawn < alreadyDrawn) { panel.assetId = `old-${drawn++}` }
      return panel
    })
    return page
  })
  return book
}

describe('drawing the pictures for a book that already exists', () => {
  it('draws only the empty panels and leaves the drawn ones alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ image: 'aGk=', mime: 'image/png' }), { status: 200 })))

    const book = comic(3, 2)
    const placed: string[] = []
    const result = await drawPanels(book, 'storybook', (_p, panelId) => placed.push(panelId), () => {})

    // Six panels, two already drawn: four to do.
    expect(result.total).toBe(4)
    expect(result.drawn).toBe(4)
    expect(placed).toHaveLength(4)
    // None of the panels that already had artwork were touched.
    const kept = book.pages.flatMap((p) => p.panels).filter((p) => p.assetId?.startsWith('old-'))
    expect(kept).toHaveLength(2)
  })

  it('has nothing to do once every panel is drawn, so pressing it again is safe', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await drawPanels(comic(2, 4), 'storybook', () => {}, () => {})
    expect(result).toMatchObject({ drawn: 0, total: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps what it drew and says why when the allowance runs out part-way', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls > 2) {
        return new Response(
          JSON.stringify({ error: { code: 'quota', message: 'The account is out of credit.' } }),
          { status: 402 })
      }
      return new Response(JSON.stringify({ image: 'aGk=', mime: 'image/png' }), { status: 200 })
    }))

    const result = await drawPanels(comic(3, 0), 'storybook', () => {}, () => {})
    expect(result.drawn).toBe(2)
    expect(result.stopped).toContain('out of credit')
  })
})

describe('a picture the service will not draw', () => {
  it('counts it and keeps what it said, instead of skipping it in silence', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      // The second panel is refused; the rest are fine.
      if (calls === 2) {
        return new Response(JSON.stringify({
          error: { code: 'rejected', message: 'The image service would not draw that.' },
        }), { status: 502 })
      }
      return new Response(JSON.stringify({ image: 'aGk=', mime: 'image/png' }), { status: 200 })
    }))

    const result = await drawPanels(comic(2, 0), 'storybook', () => {}, () => {})
    expect(result.drawn).toBe(3)
    expect(result.failed).toBe(1)
    expect(result.reason).toContain('would not draw')
    // It carried on rather than stopping at the refusal.
    expect(result.total).toBe(4)
  })

  it('tries a blip again rather than leaving a hole in the page', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      // The first attempt at the first panel dies; the retry works.
      if (calls === 1) throw new Error('ECONNRESET')
      return new Response(JSON.stringify({ image: 'aGk=', mime: 'image/png' }), { status: 200 })
    }))

    const result = await drawPanels(comic(1, 0), 'storybook', () => {}, () => {})
    expect(result.drawn).toBe(2)
    expect(result.failed).toBe(0)
    // Three calls for two panels: one of them took two goes.
    expect(calls).toBe(3)
  })

  it('still gives up at once when the allowance is spent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'quota', message: 'The account is out of credit.' } }),
      { status: 402 })))

    const result = await drawPanels(comic(3, 0), 'storybook', () => {}, () => {})
    expect(result.drawn).toBe(0)
    expect(result.stopped).toContain('out of credit')
  })
})
