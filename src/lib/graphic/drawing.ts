/**
 * Pure drawing helpers for the panel drawing board. Kept apart from the React
 * component so the fiddly parts — flood fill, stroke smoothing, colour
 * matching — can be tested directly.
 */

export type DrawTool = 'brush' | 'eraser' | 'line' | 'fill'

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface Point {
  x: number
  y: number
}

/** Parse `#rgb`, `#rrggbb`, or `#rrggbbaa`. Returns opaque black on nonsense. */
export function parseHex(hex: string): Rgba {
  const text = hex.trim().replace(/^#/, '')
  const expand = text.length === 3 || text.length === 4
    ? text.split('').map((c) => c + c).join('')
    : text
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expand)) return { r: 0, g: 0, b: 0, a: 255 }
  return {
    r: parseInt(expand.slice(0, 2), 16),
    g: parseInt(expand.slice(2, 4), 16),
    b: parseInt(expand.slice(4, 6), 16),
    a: expand.length === 8 ? parseInt(expand.slice(6, 8), 16) : 255,
  }
}

/**
 * Anti-aliased edges mean a filled region's boundary pixels are blends rather
 * than exact matches, so the fill compares within a tolerance.
 */
export function colorsMatch(data: Uint8ClampedArray, index: number, target: Rgba, tolerance: number): boolean {
  return (
    Math.abs(data[index] - target.r) <= tolerance &&
    Math.abs(data[index + 1] - target.g) <= tolerance &&
    Math.abs(data[index + 2] - target.b) <= tolerance &&
    Math.abs(data[index + 3] - target.a) <= tolerance
  )
}

/**
 * Scanline flood fill. Recursive fills blow the stack on a canvas this size,
 * so spans are walked iteratively with an explicit stack.
 *
 * Mutates `image` in place and reports whether anything changed.
 */
export function floodFill(
  image: ImageData,
  startX: number,
  startY: number,
  fill: Rgba,
  tolerance = 32,
): boolean {
  const { width, height, data } = image
  const x0 = Math.floor(startX)
  const y0 = Math.floor(startY)
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return false

  const startIndex = (y0 * width + x0) * 4
  const target: Rgba = {
    r: data[startIndex], g: data[startIndex + 1], b: data[startIndex + 2], a: data[startIndex + 3],
  }
  // Filling a region with the colour it already has would loop forever.
  if (colorsMatch(data, startIndex, fill, 0)) return false

  const stack: number[] = [x0, y0]
  let changed = false

  while (stack.length > 0) {
    const y = stack.pop() as number
    const x = stack.pop() as number
    let left = x
    const row = y * width

    while (left >= 0 && colorsMatch(data, (row + left) * 4, target, tolerance)) left--
    left++

    let right = x
    while (right < width && colorsMatch(data, (row + right) * 4, target, tolerance)) right++
    right--

    let spanAbove = false
    let spanBelow = false
    for (let i = left; i <= right; i++) {
      const index = (row + i) * 4
      data[index] = fill.r
      data[index + 1] = fill.g
      data[index + 2] = fill.b
      data[index + 3] = fill.a
      changed = true

      // Push each contiguous run above and below only once.
      if (y > 0) {
        const above = colorsMatch(data, ((y - 1) * width + i) * 4, target, tolerance)
        if (above && !spanAbove) { stack.push(i, y - 1); spanAbove = true }
        else if (!above) spanAbove = false
      }
      if (y < height - 1) {
        const below = colorsMatch(data, ((y + 1) * width + i) * 4, target, tolerance)
        if (below && !spanBelow) { stack.push(i, y + 1); spanBelow = true }
        else if (!below) spanBelow = false
      }
    }
  }
  return changed
}

/**
 * Midpoint smoothing: each segment curves through the midpoints of the raw
 * pointer samples, which turns a jagged polyline into a usable ink line.
 */
export function strokePath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length === 0) return
  if (points.length === 1) {
    const { x, y } = points[0]
    ctx.beginPath()
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle as string
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y)
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2
      const midY = (points[i].y + points[i + 1].y) / 2
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY)
    }
    const last = points[points.length - 1]
    ctx.lineTo(last.x, last.y)
  }
  ctx.stroke()
}

/** Drop samples closer than `minDistance`, so a paused pointer stops piling up points. */
export function thin(points: Point[], minDistance = 1.2): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) out.push(point)
  }
  return out.length > 0 ? out : points.slice(0, 1)
}

/**
 * The drawing surface matches the panel's shape, so a drawing lands in the
 * frame without being cropped. The longest edge is capped for memory.
 */
export function boardSize(aspect: number, longestEdge = 1400): { width: number; height: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return safeAspect >= 1
    ? { width: longestEdge, height: Math.round(longestEdge / safeAspect) }
    : { width: Math.round(longestEdge * safeAspect), height: longestEdge }
}

export const SWATCHES = [
  '#141414', '#5a5a5a', '#9b9b9b', '#ffffff',
  '#b3261e', '#e8752a', '#f0c23c', '#5c9e4a',
  '#2f7fbf', '#3a3f9e', '#7a4bb5', '#c0568f',
  '#8a5a2b', '#d8a97a', '#1d3a30', '#f2e9d8',
]
