import { describe, expect, it } from 'vitest'
import { layoutBalloon, type Rect } from '@/lib/graphic/render'
import { createBalloon } from '@/lib/graphic/pages'
import type { Balloon, BalloonKind } from '@/types'

/**
 * A stand-in for a canvas context. Real text metrics are not available under
 * jsdom, and a proportional stub is enough: what is under test is the fitting,
 * not the font. Width is read back out of the font string the layout sets.
 */
function stubContext(): CanvasRenderingContext2D {
  const ctx = {
    font: '10px sans-serif',
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10)
      return { width: text.length * size * 0.5 }
    },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

/** A portrait panel roughly the shape of one quarter of a comic page. */
const PANEL: Rect = { x: 100, y: 200, w: 293, h: 475 }
const SCALE = 0.662

function balloon(text: string, patch: Partial<Balloon> = {}, kind: BalloonKind = 'speech'): Balloon {
  return { ...createBalloon(kind), text, ...patch }
}

const WORDS = 'I have been waiting on this corner since the rain started and nobody is coming for us at all, '
const LONG = WORDS.repeat(4)

function within(box: { cx: number; cy: number; w: number; h: number }): boolean {
  return box.cx - box.w / 2 >= PANEL.x
    && box.cx + box.w / 2 <= PANEL.x + PANEL.w
    && box.cy - box.h / 2 >= PANEL.y
    && box.cy + box.h / 2 <= PANEL.y + PANEL.h
}

describe('layoutBalloon', () => {
  it('keeps the writer’s width when the text is short', () => {
    const box = layoutBalloon(stubContext(), balloon('Nobody is coming.', { width: 0.42 }), PANEL, SCALE)
    expect(box.w).toBeLessThanOrEqual(0.42 * PANEL.w + 1)
    expect(box.lines).toHaveLength(1)
  })

  it('holds a long speech inside the panel, which is clipped when it is drawn', () => {
    const box = layoutBalloon(stubContext(), balloon(LONG, { y: 0.2 }), PANEL, SCALE)
    expect(within(box)).toBe(true)
  })

  it('widens a balloon that has run taller than it is wide', () => {
    const narrow = layoutBalloon(stubContext(), balloon(LONG, { width: 0.3 }), PANEL, SCALE)
    expect(narrow.w).toBeGreaterThan(0.3 * PANEL.w)
    // Widening is what buys the lines back, so it should not also be shrinking.
    expect(narrow.h).toBeLessThanOrEqual(narrow.w)
  })

  it('slides a balloon placed against an edge back into the panel', () => {
    for (const at of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.02, y: 0.98 }]) {
      const box = layoutBalloon(stubContext(), balloon('Over here!', at), PANEL, SCALE)
      expect(within(box)).toBe(true)
    }
  })

  it('shrinks the type only once there is no width left to take', () => {
    const roomy = layoutBalloon(stubContext(), balloon('Just a line.'), PANEL, SCALE)
    const crammed = layoutBalloon(stubContext(), balloon(LONG.repeat(8)), PANEL, SCALE)
    expect(crammed.fontSize).toBeLessThan(roomy.fontSize)
    expect(within(crammed)).toBe(true)
  })

  it('breaks a single word too long to wrap instead of letting it spill', () => {
    const box = layoutBalloon(stubContext(), balloon('K'.repeat(120), { width: 0.2 }), PANEL, SCALE)
    const widest = Math.max(...box.lines.map((l) => l.length * box.fontSize * 0.5))
    expect(widest).toBeLessThanOrEqual(box.w - box.padding * 2 + 1)
  })

  it('shrinks a sound effect to keep it on one line rather than splitting it', () => {
    // A sound effect's type is sized from its own box, so widening grows the
    // lettering in step: only a smaller size can close the gap.
    const box = layoutBalloon(stubContext(), balloon('Krakoom', { width: 0.45 }, 'sfx'), PANEL, SCALE)
    expect(box.lines).toEqual(['KRAKOOM'])
  })

  it('still lays out a balloon whose text is empty', () => {
    const box = layoutBalloon(stubContext(), balloon('   '), PANEL, SCALE)
    expect(box.lines.join('')).not.toBe('')
    expect(within(box)).toBe(true)
  })
})
