import { describe, expect, it } from 'vitest'
import { buildGraphicPage, placeBalloons, readGraphicPages } from '@/lib/story/story'
import { layoutBalloon, type Rect } from '@/lib/graphic/render'
import { createBalloon } from '@/lib/graphic/pages'
import { buildScript } from '@/lib/export/comic'
import { createBook } from '@/lib/book'
import type { Balloon } from '@/types'

const written = (kind: Balloon['kind'], text: string, from: 'left' | 'middle' | 'right' | 'off') =>
  ({ balloon: { ...createBalloon(kind), text }, from } as const)

describe('a balloon points at whoever is talking', () => {
  it('reaches toward the side the speaker is standing on', () => {
    const [left, right] = placeBalloons([
      written('speech', 'Over here.', 'left'),
      written('speech', 'And me.', 'right'),
    ])
    expect(left.tailX).toBeLessThan(0.3)
    expect(right.tailX).toBeGreaterThan(0.7)
    // The tail reaches down to where a character stands, not across the top.
    expect(left.tailY).toBeGreaterThan(left.y + 0.3)
  })

  it('leans the balloon toward its speaker without hanging off the panel', () => {
    const [left, middle, right] = placeBalloons([
      written('speech', 'a', 'left'), written('speech', 'b', 'middle'), written('speech', 'c', 'right'),
    ])
    expect(left.x).toBeLessThan(middle.x)
    expect(middle.x).toBeLessThan(right.x)
    for (const balloon of [left, middle, right]) {
      expect(balloon.x).toBeGreaterThan(0.1)
      expect(balloon.x).toBeLessThan(0.9)
    }
  })

  it('stacks several balloons down the panel instead of over each other', () => {
    const placed = placeBalloons([
      written('speech', 'a', 'left'), written('speech', 'b', 'left'), written('speech', 'c', 'left'),
    ])
    const ys = placed.map((b) => b.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(new Set(ys).size).toBe(3)
    // They stay in the upper half, over sky rather than over faces.
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.62)
  })

  /** Nobody is speaking, so a tail would be pointing at nothing. */
  it('leaves a caption, a sound effect and an off-panel voice without a tail', () => {
    const panel: Rect = { x: 0, y: 0, w: 300, h: 460 }
    for (const kind of ['caption', 'sfx'] as const) {
      const [placed] = placeBalloons([written(kind, 'Later…', 'left')])
      expect(placed.tailX).toBe(0.5)
      expect(placed.tailY).toBe(placed.y)
    }
    const [offstage] = placeBalloons([written('speech', 'A voice.', 'off')])
    expect(offstage.tailY).toBe(offstage.y)
    // The renderer declines to draw a tail that would sit inside the balloon.
    const box = layoutBalloon(stub(), offstage, panel, 0.3)
    const distance = Math.hypot(
      panel.x + offstage.tailX * panel.w - box.cx,
      panel.y + offstage.tailY * panel.h - box.cy,
    )
    expect(distance).toBeLessThan(Math.max(box.w, box.h) * 0.45)
  })

  it('reads the side and the speaker the story gave', () => {
    const [page] = readGraphicPages({
      pages: [{
        panels: [{
          art: 'two foxes on a quay',
          balloons: [
            { kind: 'speech', speaker: 'Rell', from: 'right', text: 'Nobody came.' },
            { kind: 'caption', from: 'left', text: 'Later.' },
            { kind: 'speech', from: 'nonsense', text: 'Hm.' },
          ],
        }],
      }],
    })
    expect(page.panels[0].balloons.map((b) => b.from)).toEqual(['right', 'off', 'middle'])
    expect(page.panels[0].balloons[0].balloon.speaker).toBe('Rell')
  })

  it('aims the tails of a built page, not just the loose balloons', () => {
    const [page] = readGraphicPages({
      pages: [{ panels: [{ art: 'a', balloons: [{ kind: 'speech', from: 'right', text: 'Here.' }] }] }],
    })
    expect(buildGraphicPage(page, 'c').panels[0].balloons[0].tailX).toBeGreaterThan(0.7)
  })
})

describe('the script says who is speaking', () => {
  it('names the speaker beside the line when the story gave one', () => {
    const book = createBook('Comic', '', 'graphic')
    const [page] = readGraphicPages({
      pages: [{ panels: [{ art: 'a quay', balloons: [
        { kind: 'speech', speaker: 'Rell', from: 'left', text: 'Nobody came.' },
        { kind: 'caption', from: 'off', text: 'Later.' },
      ] }] }],
    })
    book.pages = [buildGraphicPage(page, 'c')]
    const script = buildScript(book)
    expect(script).toContain('SPEECH (Rell): Nobody came.')
    // Nothing is invented for a line with no speaker.
    expect(script).toContain('CAPTION: Later.')
  })
})

/** Text metrics are not available under jsdom; proportional is enough here. */
function stub(): CanvasRenderingContext2D {
  const ctx = {
    font: '10px sans-serif',
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10)
      return { width: text.length * size * 0.5 }
    },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

describe('a sound effect', () => {
  it('is set smaller than it was, but still louder than speech', () => {
    const panel: Rect = { x: 0, y: 0, w: 600, h: 300 }
    const sfx = layoutBalloon(stub(), { ...createBalloon('sfx'), text: 'Krakoom' }, panel, 0.6)
    const speech = layoutBalloon(stub(), { ...createBalloon('speech'), text: 'Krakoom' }, panel, 0.6)
    expect(sfx.fontSize).toBeGreaterThan(speech.fontSize)
    // It used to be sized at 0.19 of its box; anything near that swallows the panel.
    expect(sfx.fontSize).toBeLessThan(0.45 * 600 * 0.16)
  })
})
