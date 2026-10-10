import type { Balloon } from '@/types'

/**
 * Where the people in a panel actually are, as fractions of its width and
 * height, keyed by the lowercased character name. Supplied by the service that
 * looks at the picture; absent when it is switched off or unreachable, in which
 * case everything below falls back to reading the pixels.
 */
export type People = Map<string, { x: number; y: number }>

/** Every face in the panel, named or not — places lettering must not cover. */
export type Faces = { x: number; y: number }[]

/** The speaker's mouth sits a little below the centre of their head. */
const MOUTH_DROP = 0.05

function clamp01(v: number, pad = 0.02): number {
  return Math.min(1 - pad, Math.max(pad, v))
}

/** Where a balloon's tail should touch down for this speaker, if we know. */
export function speakerSpot(
  balloon: Balloon, people?: People,
): { x: number; y: number } | null {
  const who = (balloon.speaker ?? '').trim().toLowerCase()
  if (!who || !people) return null
  const spot = people.get(who)
  if (!spot) return null
  return { x: clamp01(spot.x), y: clamp01(spot.y + MOUTH_DROP) }
}

/** Which third of the panel a point falls in. */
export function sideOf(x: number): 'left' | 'middle' | 'right' {
  if (x < 0.38) return 'left'
  if (x > 0.62) return 'right'
  return 'middle'
}

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
  people?: People, faces: Faces = [],
): Balloon[] {
  const taken: Box[] = []

  return balloons.map((balloon) => {
    if (balloon.placed) {
      taken.push({ x: balloon.x, y: balloon.y, w: balloon.width, h: balloonHeight(balloon, panelAspect) })
      return balloon
    }

    const h = balloonHeight(balloon, panelAspect)
    const w = balloon.width
    const lettering = balloon.kind === 'speech' || balloon.kind === 'thought' || balloon.kind === 'shout'
    const found = lettering ? speakerSpot(balloon, people) : null
    const side = found
      ? sideOf(found.x)
      : balloon.side && balloon.side !== 'off' ? balloon.side : 'middle'
    const target = found ?? (lettering ? busiestSpot(map, side) : null)

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
        // A face is the one thing that must never be covered, and unlike
        // busyness it is not a guess — it was seen.
        for (const face of faces) {
          if (Math.abs(x - face.x) < w / 2 + 0.03 && Math.abs(y - face.y) < h / 2 + 0.03) cost += 30
        }

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
    return {
      ...balloon, side, x: best.x, y: best.y, tailX: target.x, tailY: target.y, fitted: true,
    }
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
/** A sound effect keeps its narrow shape in the strip. */
const SFX_BAND_WIDTH = 0.4

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
/**
 * The balloons as they go into the strip.
 *
 * Sound effects go in it with everything else — a CRASH is small, but it is
 * still ink, and ink on the picture hides some of the picture. They keep their
 * narrow shape so they still read as noise and not as dialogue.
 */
function forBand(balloons: Balloon[]): Balloon[] {
  return balloons
    .filter((b) => !b.placed)
    .map((b) => (b.kind === 'sfx' ? { ...b, width: Math.min(b.width, SFX_BAND_WIDTH) } : b))
}

/**
 * How deep a strip this panel's lettering needs, before anything is known
 * about the picture.
 *
 * The caller needs this first: the strip decides how the artwork is cropped
 * and scaled into what is left of the frame, and only once that is settled is
 * it worth asking where in *that* picture the people are.
 */
export function bandFor(balloons: Balloon[], panelAspect = 1.4): number {
  const inBand = forBand(balloons)
  if (inBand.length === 0) return 0
  const stack = inBand
    .map((b) => balloonHeight(b, panelAspect))
    .reduce((total, h) => total + h, 0) + BAND_PAD * (inBand.length + 1)
  return Math.min(MAX_BAND, stack)
}

export function fitBalloonsAbove(
  balloons: Balloon[], panelAspect = 1.4, map?: DetailMap, people?: People,
): BandFit {
  const free = balloons.filter((b) => !b.placed)
  const held = balloons.filter((b) => b.placed)
  if (free.length === 0) return { balloons, band: 0 }

  const inBand = forBand(balloons)
  const heights = inBand.map((b) => balloonHeight(b, panelAspect))
  const stack = heights.reduce((total, h) => total + h, 0) + BAND_PAD * (inBand.length + 1)
  const band = Math.min(MAX_BAND, stack)
  // Everything is squeezed to fit if the dialogue is long, rather than letting
  // the strip swallow the panel.
  const squeeze = stack > band ? band / stack : 1

  // `map` and `people` describe the artwork as it will actually be drawn —
  // inside the part of the frame the strip leaves, re-cropped to fit it. A
  // point in that picture is further down the panel than it is down the
  // picture, and aiming a tail without allowing for that is how it ends up
  // short of the person it belongs to.
  const intoPanel = (spot: { x: number; y: number }): { x: number; y: number } =>
    ({ x: spot.x, y: band + spot.y * (1 - band) })

  let y = BAND_PAD * squeeze
  const lettered = inBand.map((balloon, i) => {
    const h = heights[i] * squeeze
    const speaks = balloon.kind === 'speech' || balloon.kind === 'thought' || balloon.kind === 'shout'
    // Where this character actually is, if the picture has been looked at.
    const seen = speaks ? speakerSpot(balloon, people) : null
    const found = seen ? intoPanel(seen) : null
    const side = found
      ? sideOf(found.x)
      : balloon.side && balloon.side !== 'off' ? balloon.side : 'middle'
    // A balloon sits directly above its speaker, so the tail is short and
    // there is no mistaking who is talking. Captions stay centred.
    const x = balloon.kind === 'caption'
      ? 0.5
      : found
        ? Math.min(1 - balloon.width / 2 - 0.02, Math.max(balloon.width / 2 + 0.02, found.x))
        : { left: 0.3, middle: 0.5, right: 0.7 }[side]
    const centre = y + h / 2
    y += h + BAND_PAD * squeeze

    if (!speaks) {
      return { ...balloon, x, y: centre, tailX: x, tailY: centre, fitted: true }
    }
    // Into the picture: onto the speaker's face if it was found, and otherwise
    // onto the busiest part of their side of the frame, which is the best the
    // pixels alone can say.
    const target = found
      ?? (map
        ? intoPanel(busiestSpot(map, side))
        : { x: { left: 0.26, middle: 0.5, right: 0.74 }[side], y: 0.78 })
    const tailY = Math.max(band + 0.04, Math.min(0.96, target.y))
    return { ...balloon, side, x, y: centre, tailX: target.x, tailY, fitted: true }
  })

  // Put them back in the order they are read in.
  const byId = new Map(lettered.map((b) => [b.id, b]))
  return {
    balloons: balloons.map((b) => byId.get(b.id) ?? b),
    band: held.length === balloons.length ? 0 : band,
  }
}
