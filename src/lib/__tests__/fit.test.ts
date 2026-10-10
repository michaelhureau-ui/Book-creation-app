import { describe, expect, it } from 'vitest'
import {
  balloonHeight, busiestSpot, busynessUnder, detailMap, emptyMap, fitBalloons, fitBalloonsAbove,
} from '@/lib/graphic/fit'
import { createBalloon } from '@/lib/graphic/pages'
import type { Balloon, BalloonKind } from '@/types'

/** A panel with the detail in one place and flat quiet everywhere else. */
function mapWithSubjectAt(col: number, row: number, cols = 12, rows = 12) {
  const cells = new Array<number>(cols * rows).fill(0)
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (r >= 0 && r < rows && c >= 0 && c < cols) cells[r * cols + c] = 1
    }
  }
  return { cols, rows, cells }
}

function say(kind: BalloonKind, text: string, side?: Balloon['side']): Balloon {
  return { ...createBalloon(kind), text, side, speaker: side ? 'Rell' : undefined }
}

describe('reading a panel for where the detail is', () => {
  it('finds the edges in a picture and ignores the flat parts', () => {
    // A black square on white in the lower right of an otherwise blank panel.
    const size = 48
    const data = new Uint8ClampedArray(size * size * 4).fill(255)
    for (let y = 30; y < 42; y++) {
      for (let x = 30; x < 42; x++) {
        const i = (y * size + x) * 4
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0
      }
    }
    const map = detailMap({ data, width: size, height: size } as ImageData, 8, 8)

    // The busiest cells are around the square, not in the empty top-left.
    expect(busynessUnder(map, 0.75, 0.75, 0.3, 0.3)).toBeGreaterThan(0.2)
    expect(busynessUnder(map, 0.2, 0.2, 0.3, 0.3)).toBeLessThan(0.05)
  })

  it('looks for the speaker low on their own side of the frame', () => {
    const map = mapWithSubjectAt(2, 8)
    const left = busiestSpot(map, 'left')
    expect(left.x).toBeLessThan(0.5)
    expect(left.y).toBeGreaterThan(0.5)
    // Nothing on the right, so it falls back to the middle of that half.
    expect(busiestSpot(map, 'right').x).toBeGreaterThan(0.5)
  })

  it('guesses a taller balloon for more words', () => {
    const short = balloonHeight(say('speech', 'Hi.'), 1.4)
    const long = balloonHeight(say('speech', 'A'.repeat(300)), 1.4)
    expect(long).toBeGreaterThan(short)
    expect(long).toBeLessThanOrEqual(0.5)
  })
})

describe('fitting the lettering to the picture', () => {
  it('keeps the balloon off the character it belongs to', () => {
    // The speaker stands low-left; the balloon must not sit on top of them.
    const map = mapWithSubjectAt(2, 9)
    const [fitted] = fitBalloons([say('speech', 'Out again.', 'left')], map)
    expect(busynessUnder(map, fitted.x, fitted.y, fitted.width, 0.12)).toBeLessThan(0.2)
    // And its tail points at them.
    expect(fitted.tailX).toBeLessThan(0.5)
    expect(fitted.tailY).toBeGreaterThan(0.5)
    expect(fitted.fitted).toBe(true)
  })

  it('puts two balloons in different places rather than on top of each other', () => {
    const map = mapWithSubjectAt(6, 9)
    const [first, second] = fitBalloons(
      [say('speech', 'One.', 'left'), say('speech', 'Two.', 'right')], map)
    const apart = Math.hypot(first.x - second.x, first.y - second.y)
    expect(apart).toBeGreaterThan(0.15)
  })

  it('leans each balloon towards its own speaker', () => {
    const map = emptyMap()
    const [left, right] = fitBalloons(
      [say('speech', 'Mine.', 'left'), say('speech', 'Mine too.', 'right')], map)
    expect(left.x).toBeLessThan(right.x)
  })

  it('sends a sound effect low and a caption high', () => {
    const map = emptyMap()
    const [sfx] = fitBalloons([say('sfx', 'thump')], map)
    const [caption] = fitBalloons([say('caption', 'Midwinter.')], map)
    expect(sfx.y).toBeGreaterThan(0.6)
    expect(caption.y).toBeLessThan(0.4)
    // Neither gets a tail.
    expect(sfx.tailX).toBeCloseTo(sfx.x)
    expect(caption.tailY).toBeCloseTo(caption.y)
  })

  it('never lets a balloon hang over the edge of the panel', () => {
    const map = mapWithSubjectAt(6, 6)
    const fitted = fitBalloons([
      say('speech', 'A long line of dialogue that needs a wide balloon indeed.', 'left'),
      say('speech', 'And another one just as long, to crowd the panel further.', 'right'),
      say('sfx', 'KRAKKA-THOOM'),
    ], map)
    for (const balloon of fitted) {
      expect(balloon.x - balloon.width / 2).toBeGreaterThanOrEqual(0)
      expect(balloon.x + balloon.width / 2).toBeLessThanOrEqual(1)
      expect(balloon.y).toBeGreaterThan(0)
      expect(balloon.y).toBeLessThan(1)
    }
  })

  it('leaves a balloon somebody placed by hand exactly where it is', () => {
    const map = mapWithSubjectAt(2, 9)
    const mine: Balloon = { ...say('speech', 'Here.', 'left'), x: 0.8, y: 0.2, placed: true }
    const [out] = fitBalloons([mine], map)
    expect(out).toEqual(mine)
  })

  it('changes nothing but where things sit', () => {
    const map = mapWithSubjectAt(3, 8)
    const before = say('speech', 'Out again, third time this week.', 'left')
    const [after] = fitBalloons([before], map)
    expect(after.text).toBe(before.text)
    expect(after.speaker).toBe(before.speaker)
    expect(after.kind).toBe(before.kind)
    expect(after.width).toBe(before.width)
    expect(after.id).toBe(before.id)
  })
})

describe('lettering above the picture, where it cannot cover anything', () => {
  it('stacks every balloon inside the strip it reserves', () => {
    const { balloons, band } = fitBalloonsAbove([
      say('speech', 'Out again. Third time this week.', 'left'),
      say('speech', 'The wind has opinions.', 'right'),
    ], 1.6)

    expect(band).toBeGreaterThan(0)
    for (const balloon of balloons.filter((b) => b.kind !== 'sfx')) {
      // Wholly inside the clear strip: nothing dips into the artwork.
      expect(balloon.y + balloonHeight(balloon, 1.6) / 2).toBeLessThanOrEqual(band + 0.001)
    }
  })

  it('still points the tails down into the picture, at the speaker', () => {
    const { balloons, band } = fitBalloonsAbove([
      say('speech', 'Mine.', 'left'),
      say('speech', 'Mine too.', 'right'),
    ], 1.6)
    const [left, right] = balloons
    expect(left.tailY).toBeGreaterThan(band)
    expect(right.tailY).toBeGreaterThan(band)
    expect(left.tailX).toBeLessThan(right.tailX)
  })

  it('never lets the strip swallow the panel, however much is said', () => {
    const chatty = Array.from({ length: 6 }, (_, i) =>
      say('speech', `${'A rather long line of dialogue. '.repeat(3)} ${i}`, 'left'))
    const { balloons, band } = fitBalloonsAbove(chatty, 1.6)
    expect(band).toBeLessThanOrEqual(0.55)
    for (const balloon of balloons) expect(balloon.y).toBeLessThan(0.56)
  })

  it('leaves sound effects down on the artwork, where they belong', () => {
    const { balloons } = fitBalloonsAbove([say('speech', 'Look out.', 'left'), say('sfx', 'THUMP')], 1.6)
    const noise = balloons.find((b) => b.kind === 'sfx')!
    expect(noise.y).toBeGreaterThan(0.75)
  })

  it('keeps the reading order, the words and the speakers', () => {
    const before = [say('caption', 'Midwinter.'), say('speech', 'Out again.', 'left')]
    const { balloons } = fitBalloonsAbove(before, 1.6)
    expect(balloons.map((b) => b.id)).toEqual(before.map((b) => b.id))
    expect(balloons.map((b) => b.text)).toEqual(before.map((b) => b.text))
    expect(balloons[0].y).toBeLessThan(balloons[1].y)
  })

  it('reserves nothing when every balloon was placed by hand', () => {
    const mine: Balloon = { ...say('speech', 'Here.', 'left'), placed: true }
    const { balloons, band } = fitBalloonsAbove([mine], 1.6)
    expect(band).toBe(0)
    expect(balloons[0]).toEqual(mine)
  })
})

describe('where a sound effect lands', () => {
  it('takes the quieter corner when the picture says which that is', () => {
    // The character is low-left, so the noise should go right.
    const map = mapWithSubjectAt(2, 9)
    const { balloons } = fitBalloonsAbove([say('sfx', 'THUMP')], 1.6, map)
    expect(balloons[0].x).toBeGreaterThan(0.5)
  })

  it('sends a second one to the other side', () => {
    const map = mapWithSubjectAt(2, 9)
    const { balloons } = fitBalloonsAbove([say('sfx', 'THUMP'), say('sfx', 'CRACK')], 1.6, map)
    expect(Math.sign(balloons[0].x - 0.5)).not.toBe(Math.sign(balloons[1].x - 0.5))
  })
})
