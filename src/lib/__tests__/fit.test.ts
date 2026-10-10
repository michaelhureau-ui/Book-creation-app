import { describe, expect, it } from 'vitest'
import {
  balloonHeight, busiestSpot, busynessUnder, detailMap, emptyMap, fitBalloons, fitBalloonsAbove,
  bandFor, sideOf, speakerSpot, type People,
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

/** A line with a named speaker, for the cases where who matters. */
function spoken(text: string, speaker: string): Balloon {
  return { ...createBalloon('speech'), text, speaker }
}

/** Where the service that looked at the picture says people are. */
function found(spots: Record<string, [number, number]>): People {
  return new Map(Object.entries(spots).map(([name, [x, y]]) => [name, { x, y }]))
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

  it('puts sound effects in the strip too, so no ink lands on the picture', () => {
    const { balloons, band } = fitBalloonsAbove(
      [say('speech', 'Look out.', 'left'), say('sfx', 'THUMP')], 1.6,
    )
    const noise = balloons.find((b) => b.kind === 'sfx')!
    expect(noise.y + balloonHeight(noise, 1.6) / 2).toBeLessThanOrEqual(band + 0.001)
    // And no tail, so nothing reaches down out of the strip either.
    expect(noise.tailX).toBeCloseTo(noise.x)
    expect(noise.tailY).toBeCloseTo(noise.y)
  })

  it('counts the sound effect when working out how deep the strip must be', () => {
    const speech = [say('speech', 'Look out.', 'left')]
    const quiet = fitBalloonsAbove(speech, 1.6).band
    const loud = fitBalloonsAbove([...speech, say('sfx', 'THUMP')], 1.6).band
    expect(loud).toBeGreaterThan(quiet)
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
  it('keeps its narrow shape rather than spreading like a caption', () => {
    const wide = { ...say('sfx', 'THUMP'), width: 0.9 }
    const { balloons } = fitBalloonsAbove([wide], 1.6)
    expect(balloons[0].width).toBeLessThanOrEqual(0.4)
  })

  it('stacks two of them without either sitting on the other', () => {
    const { balloons } = fitBalloonsAbove([say('sfx', 'THUMP'), say('sfx', 'CRACK')], 1.6)
    expect(balloons[0].y).toBeLessThan(balloons[1].y)
  })
})

describe('aiming at the person who is actually speaking', () => {
  it('reads a point as being on the left, in the middle or on the right', () => {
    expect(sideOf(0.1)).toBe('left')
    expect(sideOf(0.5)).toBe('middle')
    expect(sideOf(0.9)).toBe('right')
  })

  it('finds the speaker whatever case their name was written in', () => {
    const spot = speakerSpot(spoken('Here.', 'Kara'), found({ kara: [0.8, 0.4] }))
    expect(spot?.x).toBeCloseTo(0.8)
    // The mouth is a little below the middle of the head.
    expect(spot!.y).toBeGreaterThan(0.4)
  })

  it('knows when it was not told where somebody is', () => {
    expect(speakerSpot(spoken('Here.', 'Dev'), found({ kara: [0.8, 0.4] }))).toBeNull()
    expect(speakerSpot(spoken('Here.', 'Kara'), undefined)).toBeNull()
  })

  it('puts the tail on the speaker rather than on the busiest part of the picture', () => {
    // The pixels say the detail is low-left. The picture says Kara is on the
    // right — and the picture is the one that knows.
    const map = mapWithSubjectAt(2, 9)
    const { balloons } = fitBalloonsAbove(
      [spoken('Over here.', 'Kara')], 1.6, map, found({ kara: [0.82, 0.55] }),
    )
    expect(balloons[0].tailX).toBeCloseTo(0.82, 1)
    expect(balloons[0].side).toBe('right')
  })

  it('sits the balloon above its speaker, so the tail is short', () => {
    const { balloons } = fitBalloonsAbove(
      [spoken('Over here.', 'Kara')], 1.6, undefined, found({ kara: [0.78, 0.6] }),
    )
    expect(Math.abs(balloons[0].x - balloons[0].tailX)).toBeLessThan(0.12)
  })

  it('aims two speakers at their own faces, not at one shared guess', () => {
    const { balloons } = fitBalloonsAbove(
      [spoken('Mine.', 'Kara'), spoken('Mine too.', 'Dev')],
      1.6, undefined, found({ kara: [0.2, 0.6], dev: [0.85, 0.5] }),
    )
    expect(balloons[0].tailX).toBeLessThan(0.4)
    expect(balloons[1].tailX).toBeGreaterThan(0.7)
  })

  it('allows for the picture being pushed down the panel by the strip', () => {
    // The service looked at the artwork as it will be drawn — inside the part
    // of the frame left under the strip. A face a tenth of the way down *that*
    // picture is most of the way down the panel, and a tail that forgets the
    // difference stops short of the person.
    const lines = [
      spoken('Up here.', 'Kara'),
      spoken('I see you.', 'Dev'),
      spoken('Then come up.', 'Kara'),
    ]
    const band = bandFor(lines, 1.6)
    expect(band).toBeGreaterThan(0.2)

    const { balloons } = fitBalloonsAbove(
      lines, 1.6, undefined, found({ kara: [0.3, 0.1], dev: [0.8, 0.1] }),
    )
    for (const balloon of balloons) {
      expect(balloon.tailY).toBeGreaterThan(band)
      // A tenth of the way down the picture, which starts where the strip ends.
      expect(balloon.tailY).toBeCloseTo(band + (0.1 + 0.05) * (1 - band), 2)
    }
  })

  it('works out the strip before the picture has been read', () => {
    const lines = [spoken('Up here.', 'Kara'), say('sfx', 'THUMP')]
    expect(bandFor(lines, 1.6)).toBeCloseTo(fitBalloonsAbove(lines, 1.6).band, 5)
    expect(bandFor([], 1.6)).toBe(0)
  })

  it('falls back to reading the picture when nobody was located', () => {
    const map = mapWithSubjectAt(2, 9)
    const { balloons, band } = fitBalloonsAbove([say('speech', 'Here.', 'left')], 1.6, map)
    expect(balloons[0].tailY).toBeGreaterThan(band)
  })
})

describe('keeping off a face that was actually seen', () => {
  it('moves a balloon off a face even where the picture reads as quiet', () => {
    // A flat panel: by busyness alone every spot is equally good, so the only
    // thing that can push the balloon off the face is having been told it is
    // there.
    const map = emptyMap()
    const line = say('speech', 'Hello.', 'middle')
    const [clear] = fitBalloons([line], map, 1.6, undefined, [{ x: 0.5, y: 0.14 }])
    expect(
      Math.abs(clear.x - 0.5) > clear.width / 2
      || Math.abs(clear.y - 0.14) > balloonHeight(clear, 1.6) / 2,
    ).toBe(true)
  })

  it('still points the tail at the located speaker in this mode', () => {
    const map = mapWithSubjectAt(2, 9)
    const [only] = fitBalloons(
      [spoken('Over here.', 'Kara')], map, 1.6, found({ kara: [0.85, 0.5] }),
    )
    expect(only.tailX).toBeCloseTo(0.85, 1)
  })
})
