import type { Balloon } from '@/types'

/**
 * How busy each part of a panel's artwork is, as a coarse grid.
 *
 * Faces, hands and detail carry edges; sky, water, walls and fog do not. That
 * is enough to letter around: a balloon belongs over the quiet parts, and the
 * tail belongs on the busy part nearest whoever is speaking.
 */
export interface DetailMap {
  cols: number
  rows: number
  /** Row-major, 0 (flat) to 1 (the busiest cell in this panel). */
  cells: number[]
}

/** Edge energy per cell, from the pixels actually visible in the panel. */
export function detailMap(pixels: ImageData, cols = 12, rows = 12): DetailMap {
  const { width, height, data } = pixels
  const cells = new Array<number>(cols * rows).fill(0)
  const counts = new Array<number>(cols * rows).fill(0)

  const luma = (x: number, y: number): number => {
    const i = (y * width + x) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  for (let y = 0; y < height - 1; y++) {
    const row = Math.min(rows - 1, Math.floor((y / height) * rows))
    for (let x = 0; x < width - 1; x++) {
      const col = Math.min(cols - 1, Math.floor((x / width) * cols))
      const here = luma(x, y)
      const edge = Math.abs(here - luma(x + 1, y)) + Math.abs(here - luma(x, y + 1))
      cells[row * cols + col] += edge
      counts[row * cols + col]++
    }
  }

  for (let i = 0; i < cells.length; i++) cells[i] /= Math.max(1, counts[i])
  const loudest = Math.max(...cells, 1)
  return { cols, rows, cells: cells.map((v) => v / loudest) }
}

/** A flat map, for a panel with no artwork behind it yet. */
export function emptyMap(cols = 12, rows = 12): DetailMap {
  return { cols, rows, cells: new Array<number>(cols * rows).fill(0) }
}

/** Average busyness under a box given in panel fractions. */
export function busynessUnder(
  map: DetailMap, x: number, y: number, w: number, h: number,
): number {
  const left = Math.max(0, Math.floor((x - w / 2) * map.cols))
  const right = Math.min(map.cols - 1, Math.ceil((x + w / 2) * map.cols) - 1)
  const top = Math.max(0, Math.floor((y - h / 2) * map.rows))
  const bottom = Math.min(map.rows - 1, Math.ceil((y + h / 2) * map.rows) - 1)

  let total = 0
  let seen = 0
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      total += map.cells[row * map.cols + col] ?? 0
      seen++
    }
  }
  return seen ? total / seen : 0
}

/**
 * Where the speaker probably is: the busiest place in the lower two thirds of
 * the half of the panel they were put on.
 *
 * Characters stand in the frame, not in the sky, so the lower band is where to
 * look — and the busiest part of it is a face, a coat, a pair of hands.
 */
export function busiestSpot(
  map: DetailMap, side: 'left' | 'middle' | 'right',
): { x: number; y: number } {
  const bounds = { left: [0, 0.5], middle: [0.2, 0.8], right: [0.5, 1] }[side]
  let best = { x: (bounds[0] + bounds[1]) / 2, y: 0.68 }
  let bestScore = -1

  for (let row = Math.floor(map.rows * 0.3); row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const x = (col + 0.5) / map.cols
      if (x < bounds[0] || x > bounds[1]) continue
      const score = map.cells[row * map.cols + col] ?? 0
      if (score > bestScore) {
        bestScore = score
        best = { x, y: (row + 0.5) / map.rows }
      }
    }
  }
  return best
}

/** Roughly how tall a balloon of this width is, as a fraction of the panel. */
export function balloonHeight(balloon: Balloon, panelAspect: number): number {
  // About forty characters fit across a balloon the full width of a panel.
  const perLine = Math.max(8, balloon.width * 40)
  const lines = Math.max(1, Math.ceil(balloon.text.trim().length / perLine))
  // A line is about a fifteenth of the panel's height at a typical panel shape.
  return Math.min(0.5, lines * 0.085 * Math.max(0.6, Math.min(2, panelAspect)))
}

interface Box { x: number; y: number; w: number; h: number }

function overlap(a: Box, b: Box): number {
  const wide = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)
  const tall = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2)
  return wide > 0 && tall > 0 ? wide * tall : 0
}

/**
 * Letter a panel over its artwork: balloons on the quiet parts, tails on the
 * speaker, nothing on top of anything else.
 *
 * The words were written before the pictures existed, so they sit where a
 * blank panel suggested — which, once there is a picture underneath, is often
 * straight across somebody's face. This moves them, and only them: the reading
 * order, the text and who says what are left exactly as they are.
 */
export function fitBalloons(
  balloons: Balloon[], map: DetailMap, panelAspect = 1.4,
): Balloon[] {
  const taken: Box[] = []

  return balloons.map((balloon) => {
    if (balloon.placed) {
      taken.push({ x: balloon.x, y: balloon.y, w: balloon.width, h: balloonHeight(balloon, panelAspect) })
      return balloon
    }

    const h = balloonHeight(balloon, panelAspect)
    const w = balloon.width
    const side = balloon.side && balloon.side !== 'off' ? balloon.side : 'middle'
    const lettering = balloon.kind === 'speech' || balloon.kind === 'thought' || balloon.kind === 'shout'
    const target = lettering ? busiestSpot(map, side) : null

    let best = { x: balloon.x, y: balloon.y }
    let bestCost = Infinity

    // Candidate centres across the panel, kept far enough in that nothing hangs
    // over the frame edge.
    for (let ty = 0; ty <= 20; ty++) {
      for (let tx = 0; tx <= 20; tx++) {
        const x = Math.min(1 - w / 2 - 0.02, Math.max(w / 2 + 0.02, tx / 20))
        const y = Math.min(1 - h / 2 - 0.02, Math.max(h / 2 + 0.02, ty / 20))
        const box = { x, y, w, h }

        // What it would cover, what it would collide with, and how far it
        // would sit from where this kind of balloon belongs.
        let cost = busynessUnder(map, x, y, w, h) * 3
        for (const other of taken) cost += overlap(box, other) * 24

        if (balloon.kind === 'sfx') {
          // Sound effects belong low and out of the way.
          cost += (1 - y) * 1.2 + Math.abs(Math.abs(x - 0.5) - 0.26) * 0.8
        } else if (balloon.kind === 'caption') {
          cost += y * 2.2 + Math.abs(x - 0.5) * 0.5
        } else {
          // Speech reads from the top, and leans towards its speaker.
          cost += y * 1.4
          cost += Math.abs(x - { left: 0.3, middle: 0.5, right: 0.7 }[side]) * 1.1
          // A tail that has to cross the whole panel is a tail nobody follows.
          if (target) cost += Math.hypot(x - target.x, y - target.y) * 0.5
          // And it must not sit on top of the person it belongs to.
          if (target && Math.abs(x - target.x) < w / 2 && Math.abs(y - target.y) < h / 2) cost += 2
        }

        if (cost < bestCost) { bestCost = cost; best = { x, y } }
      }
    }

    taken.push({ x: best.x, y: best.y, w, h })

    if (!target) {
      // No tail: it sits on the balloon, which is how the renderer is told not
      // to draw one.
      return { ...balloon, x: best.x, y: best.y, tailX: best.x, tailY: best.y, fitted: true }
    }
    return { ...balloon, x: best.x, y: best.y, tailX: target.x, tailY: target.y, fitted: true }
  })
}

/** How the lettering should sit against the artwork. */
export type FitMode = 'band' | 'over'

export interface BandFit {
  balloons: Balloon[]
  /** The strip of panel to keep clear, as a fraction of its height. */
  band: number
}

/** Nothing may be hidden behind the words, so the strip stops here. */
const MAX_BAND = 0.55
/** A little air between the last balloon and the top of the picture. */
const BAND_PAD = 0.02

/**
 * Letter above the picture rather than on top of it.
 *
 * Working out which part of a drawing can be covered is guesswork — on painted
 * artwork every square inch carries detail, and the quiet place the app picks
 * is as likely as not to be a face. Leaving room for the words is not
 * guesswork: the picture is drawn a little smaller, the lettering sits in the
 * strip above it, and nothing is ever hidden.
 *
 * Tails still reach down into the artwork, at the speaker's side, so it still
 * reads as a comic rather than as a caption with a picture under it.
 */
export function fitBalloonsAbove(
  balloons: Balloon[], panelAspect = 1.4, map?: DetailMap,
): BandFit {
  const free = balloons.filter((b) => !b.placed)
  const held = balloons.filter((b) => b.placed)
  if (free.length === 0) return { balloons, band: 0 }

  // Sound effects stay in the picture: they belong on the noise, they are
  // small, and they are the one piece of lettering meant to sit on the art.
  const inBand = free.filter((b) => b.kind !== 'sfx')
  const noises = free.filter((b) => b.kind === 'sfx')

  const heights = inBand.map((b) => balloonHeight(b, panelAspect))
  const stack = heights.reduce((total, h) => total + h, 0) + BAND_PAD * (inBand.length + 1)
  const band = Math.min(MAX_BAND, stack)
  // Everything is squeezed to fit if the dialogue is long, rather than letting
  // the strip swallow the panel.
  const squeeze = stack > band ? band / stack : 1

  let y = BAND_PAD * squeeze
  const lettered = inBand.map((balloon, i) => {
    const h = heights[i] * squeeze
    const side = balloon.side && balloon.side !== 'off' ? balloon.side : 'middle'
    const x = balloon.kind === 'caption'
      ? 0.5
      : { left: 0.3, middle: 0.5, right: 0.7 }[side]
    const centre = y + h / 2
    y += h + BAND_PAD * squeeze

    const speaks = balloon.kind === 'speech' || balloon.kind === 'thought' || balloon.kind === 'shout'
    if (!speaks) {
      return { ...balloon, x, y: centre, tailX: x, tailY: centre, fitted: true }
    }
    // Into the picture, on the speaker's side: below the strip, where a
    // character is standing.
    const target = map
      ? busiestSpot(map, side)
      : { x: { left: 0.26, middle: 0.5, right: 0.74 }[side], y: 0.78 }
    const tailY = Math.max(band + 0.08, Math.min(0.94, target.y))
    return { ...balloon, x, y: centre, tailX: target.x, tailY, fitted: true }
  })

  // A sound effect stays on the artwork — it belongs on the noise — but it can
  // at least take the quieter corner rather than landing on whoever is making
  // it.
  const quietSide = (skip: number): number => {
    if (!map) return skip % 2 === 0 ? 0.26 : 0.74
    const left = busynessUnder(map, 0.26, 0.86, 0.4, 0.16)
    const right = busynessUnder(map, 0.74, 0.86, 0.4, 0.16)
    const quieter = left <= right ? 0.26 : 0.74
    // A second one goes opposite, so two never land on each other.
    return skip % 2 === 0 ? quieter : 1 - quieter
  }

  const low = noises.map((balloon, i) => {
    const x = quietSide(i)
    return {
      ...balloon,
      x,
      y: 0.86,
      width: Math.min(balloon.width, 0.4),
      tailX: x,
      tailY: 0.86,
      fitted: true,
    }
  })

  // Put them back in the order they are read in.
  const byId = new Map([...lettered, ...low].map((b) => [b.id, b]))
  return {
    balloons: balloons.map((b) => byId.get(b.id) ?? b),
    band: held.length === balloons.length ? 0 : band,
  }
}
