import type { Balloon } from '@/types'

/** Which side of the frame a speaker stands on. */
export type SpeakerSide = 'left' | 'middle' | 'right' | 'off'

/** The tail touches down where the speaker is standing, not in the corner. */
const TAIL_X: Record<Exclude<SpeakerSide, 'off'>, number> = { left: 0.18, middle: 0.5, right: 0.82 }
const TAIL_Y = 0.68

/** The balloon leans toward its speaker without hanging off the panel. */
const BODY_X: Record<Exclude<SpeakerSide, 'off'>, number> = { left: 0.3, middle: 0.5, right: 0.7 }

/**
 * Where a sound effect goes: low, to one side, and no wider than two fifths of
 * the frame. It used to sit in the middle at full width, across the face of
 * whatever was making the noise.
 */
const SFX_X = 0.26
const SFX_Y = 0.84
const SFX_WIDTH = 0.4

/**
 * Put every balloon where it belongs: speech leaning towards whoever is
 * speaking with its tail on them, captions across the top, and sound effects
 * down in a corner where they are not covering the picture.
 *
 * Run whenever a page is read as well as when it is written, so a book made
 * before any of this existed comes right the moment it is opened again. A
 * balloon somebody has dragged by hand is left exactly where they put it.
 */
export function aimBalloons(balloons: Balloon[]): Balloon[] {
  // Where each speaker stands, taken from the story if it said and worked out
  // from the order they speak in if it did not: the first voice on the left,
  // the second on the right, as a comic is drawn.
  const sides = new Map<string, Exclude<SpeakerSide, 'off'>>()
  const free: Exclude<SpeakerSide, 'off'>[] = ['left', 'right', 'middle']
  for (const balloon of balloons) {
    const who = (balloon.speaker ?? '').trim().toLowerCase()
    if (!who || balloon.kind === 'caption' || balloon.kind === 'sfx') continue
    if (sides.has(who)) continue
    const said = balloon.side
    const side = said && said !== 'off' ? said : free[sides.size % free.length]
    sides.set(who, side)
  }

  let speaking = 0
  let noises = 0
  return balloons.map((balloon) => {
    // Hand-placed, or already fitted to the picture underneath: either way this
    // knows less about where it belongs than whoever put it there.
    if (balloon.placed || balloon.fitted) return balloon

    if (balloon.kind === 'sfx') {
      // A sound effect sat in the middle of the frame hides the very thing it
      // is meant to be happening to. Low and to one side, alternating so two
      // of them never land on top of each other.
      const left = noises++ % 2 === 0
      return {
        ...balloon,
        side: 'off',
        x: left ? SFX_X : 1 - SFX_X,
        y: SFX_Y,
        width: Math.min(balloon.width, SFX_WIDTH),
        tailX: left ? SFX_X : 1 - SFX_X,
        tailY: SFX_Y,
      }
    }

    if (balloon.kind === 'caption') {
      return { ...balloon, side: 'off', x: 0.5, y: 0.12, tailX: 0.5, tailY: 0.12 }
    }

    const y = Math.min(0.58, 0.16 + speaking++ * 0.19)

    // A voice from off the panel has nobody to point at, and a tail drawn to
    // nowhere reads as a mistake. The tail sits on the balloon, which is how
    // the renderer is told not to draw one.
    if (balloon.side === 'off') return { ...balloon, x: 0.5, y, tailX: 0.5, tailY: y }

    const who = (balloon.speaker ?? '').trim().toLowerCase()
    const side = sides.get(who) ?? (balloon.side ?? null)
    if (!side) return { ...balloon, x: 0.5, y, tailX: 0.5, tailY: TAIL_Y }
    return { ...balloon, side, x: BODY_X[side], y, tailX: TAIL_X[side], tailY: TAIL_Y }
  })
}
