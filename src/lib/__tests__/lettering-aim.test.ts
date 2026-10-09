import { describe, expect, it } from 'vitest'
import { aimBalloons } from '@/lib/graphic/lettering'
import { createBalloon, createPage, createPanel } from '@/lib/graphic/pages'
import { createBook, normalizeBook } from '@/lib/book'
import type { Balloon, BalloonKind } from '@/types'

function say(kind: BalloonKind, text: string, speaker?: string, side?: Balloon['side']): Balloon {
  return { ...createBalloon(kind), text, speaker, side }
}

/** The tail's horizontal landing point, which is what "points at" means. */
const tail = (b: Balloon): number => b.tailX

describe('aiming every tail at whoever is speaking', () => {
  it('sends each speaker’s tail to the side the story put them on', () => {
    const aimed = aimBalloons([
      say('speech', 'Out again.', 'Rell', 'left'),
      say('speech', 'The wind has opinions.', 'Hask', 'right'),
    ])
    expect(tail(aimed[0])).toBeLessThan(0.3)
    expect(tail(aimed[1])).toBeGreaterThan(0.7)
    // And the balloon itself leans that way, rather than sitting centred.
    expect(aimed[0].x).toBeLessThan(aimed[1].x)
  })

  it('works out sides for a book written before sides were recorded', () => {
    // No side on any of them: the first voice takes the left, the second the
    // right, as a comic is drawn.
    const aimed = aimBalloons([
      say('speech', 'Out again.', 'Rell'),
      say('speech', 'The wind has opinions.', 'Hask'),
      say('speech', 'Third time this week.', 'Rell'),
    ])
    expect(tail(aimed[0])).toBeLessThan(0.3)
    expect(tail(aimed[1])).toBeGreaterThan(0.7)
    // The same character keeps the same side all through the panel.
    expect(tail(aimed[2])).toBe(tail(aimed[0]))
  })

  it('stacks a speaker’s balloons down the panel rather than on top of each other', () => {
    const aimed = aimBalloons([
      say('speech', 'One.', 'Rell'),
      say('speech', 'Two.', 'Hask'),
    ])
    expect(aimed[1].y).toBeGreaterThan(aimed[0].y)
  })

  it('never puts a tail on a caption or a sound effect', () => {
    const aimed = aimBalloons([
      say('caption', 'Midwinter.'),
      say('sfx', 'thump'),
    ])
    for (const balloon of aimed) {
      expect(balloon.side).toBe('off')
      // Tail on the balloon itself means no tail is drawn anywhere.
      expect(balloon.tailX).toBeCloseTo(balloon.x)
      expect(balloon.tailY).toBeCloseTo(balloon.y)
    }
  })

  it('moves sound effects out of the middle so the picture can be seen', () => {
    const aimed = aimBalloons([say('sfx', 'thump'), say('sfx', 'crack')])
    for (const noise of aimed) {
      // Low in the frame and off to one side, not across the face of it.
      expect(noise.y).toBeGreaterThan(0.75)
      expect(Math.abs(noise.x - 0.5)).toBeGreaterThan(0.15)
      expect(noise.width).toBeLessThanOrEqual(0.4)
    }
    // Two of them land on opposite sides rather than on top of each other.
    expect(Math.sign(aimed[0].x - 0.5)).not.toBe(Math.sign(aimed[1].x - 0.5))
  })

  it('leaves a balloon somebody has dragged exactly where they put it', () => {
    const dragged: Balloon = { ...say('speech', 'Here.', 'Rell'), x: 0.9, y: 0.05, tailX: 0.95, tailY: 0.1, placed: true }
    expect(aimBalloons([dragged])[0]).toEqual(dragged)
  })
})

describe('opening a book tidies the lettering it already has', () => {
  it('aims the tails of a book written before any of this existed', () => {
    const book = normalizeBook({
      ...createBook('The Ashfall Alliance', '', 'graphic'),
      pages: [{
        ...createPage(),
        panels: [{
          ...createPanel(),
          balloons: [
            // Both tails dumped in the middle, the way they used to be.
            { ...say('speech', 'Out again.', 'Rell'), tailX: 0.5, tailY: 0.5 },
            { ...say('speech', 'The wind has opinions.', 'Hask'), tailX: 0.5, tailY: 0.5 },
            { ...say('sfx', 'thump'), x: 0.5, y: 0.4, width: 0.8 },
          ],
        }],
      }],
    })

    const [rell, hask, noise] = book.pages[0].panels[0].balloons
    expect(rell.tailX).toBeLessThan(0.3)
    expect(hask.tailX).toBeGreaterThan(0.7)
    // And the sound effect is out of the way of the picture.
    expect(noise.y).toBeGreaterThan(0.75)
    expect(noise.width).toBeLessThanOrEqual(0.4)
  })
})
