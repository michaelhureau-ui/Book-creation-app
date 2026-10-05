import type { Balloon, BalloonKind, Page, Panel } from '@/types'
import { frameToRect, layoutOf, type PageGeometry } from '@/lib/graphic/layouts'

export type TrimId = 'comic' | 'a4' | 'square'

export interface Trim {
  id: TrimId
  label: string
  /** Inches. */
  width: number
  height: number
}

export const TRIMS: Trim[] = [
  { id: 'comic', label: 'Comic (6.625 × 10.25 in)', width: 6.625, height: 10.25 },
  { id: 'a4', label: 'A4 (8.27 × 11.69 in)', width: 8.27, height: 11.69 },
  { id: 'square', label: 'Square (8 × 8 in)', width: 8, height: 8 },
]

export function trimOf(id: TrimId): Trim {
  return TRIMS.find((t) => t.id === id) ?? TRIMS[0]
}

export interface RenderOptions {
  trim: TrimId
  dpi: number
  /** Panel border thickness in page pixels; 0 draws borderless art. */
  border?: number
}

const INK = '#141414'
const PAPER = '#ffffff'
const EMPTY_PANEL = '#ece7dd'

/** The lettering stack: comic faces where present, a clean sans everywhere else. */
const LETTERING = '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Bradley Hand", system-ui, sans-serif'

export function pageGeometry(opts: RenderOptions): PageGeometry {
  const trim = trimOf(opts.trim)
  const width = Math.round(trim.width * opts.dpi)
  const height = Math.round(trim.height * opts.dpi)
  return {
    width,
    height,
    margin: Math.round(width * 0.045),
    gutter: Math.round(width * 0.022),
  }
}

// ── Text ─────────────────────────────────────────────────────────────────────

/** Split a word that cannot fit on a line of its own, as a letterer would. */
function breakWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const parts: string[] = []
  let part = ''
  for (const char of word) {
    const candidate = part + char
    if (part && ctx.measureText(candidate).width > maxWidth) {
      parts.push(part)
      part = char
    } else {
      part = candidate
    }
  }
  if (part) parts.push(part)
  return parts
}

/**
 * Greedy wrap that also honours the line breaks the writer typed. `broke` says
 * a word had to be split to fit, which the caller treats as a reason to try a
 * smaller size first — splitting a word is the last resort, not the first.
 */
function wrapText(
  ctx: CanvasRenderingContext2D, text: string, maxWidth: number,
): { lines: string[]; broke: boolean } {
  const lines: string[] = []
  let broke = false
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue }
      if (line) { lines.push(line); line = '' }
      if (ctx.measureText(word).width <= maxWidth) { line = word; continue }
      // Nothing to wrap at: a single run of characters wider than the line.
      // Breaking it beats letting it run out past the balloon.
      const parts = breakWord(ctx, word, maxWidth)
      if (parts.length > 1) broke = true
      lines.push(...parts.slice(0, -1))
      line = parts[parts.length - 1] ?? ''
    }
    if (line) lines.push(line)
  }
  return { lines, broke }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** The scalloped outline of a thought balloon. */
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const bumps = Math.max(8, Math.round(w / 26))
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2
  const ry = h / 2
  ctx.beginPath()
  for (let i = 0; i <= bumps; i++) {
    const angle = (i / bumps) * Math.PI * 2
    // Alternating radii give the outline its lobed, cloud-like edge.
    const wobble = i % 2 === 0 ? 1 : 0.86
    const px = cx + Math.cos(angle) * rx * wobble
    const py = cy + Math.sin(angle) * ry * wobble
    if (i === 0) ctx.moveTo(px, py)
    else {
      const prev = ((i - 1) / bumps) * Math.PI * 2
      const mid = (angle + prev) / 2
      const qx = cx + Math.cos(mid) * rx * 1.1
      const qy = cy + Math.sin(mid) * ry * 1.1
      ctx.quadraticCurveTo(qx, qy, px, py)
    }
  }
  ctx.closePath()
}

/** A jagged starburst, for a shout. */
function burst(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const spikes = 16
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
    const reach = i % 2 === 0 ? 1.16 : 0.84
    const px = cx + Math.cos(angle) * (w / 2) * reach
    const py = cy + Math.sin(angle) * (h / 2) * reach
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface BalloonLayout {
  /** Centre of the drawn balloon — not necessarily where the writer put it. */
  cx: number
  cy: number
  w: number
  h: number
  font: string
  fontSize: number
  lineHeight: number
  padding: number
  lines: string[]
}

/** Lettering never shrinks below this, in page pixels at scale 1. */
const MIN_FONT = 7.5
/** Enough steps to go from a full panel down to the floor. */
const FIT_STEPS = 16
/**
 * How tall a balloon may get relative to its width before it is widened.
 * A balloon twenty lines deep and six words across reads like a column of
 * newsprint, not like someone speaking.
 */
const TALL_LIMIT = 1

function clampTo(value: number, lo: number, hi: number): number {
  // A balloon wider than the room it has is centred rather than pinned.
  if (lo > hi) return (lo + hi) / 2
  return Math.min(hi, Math.max(lo, value))
}

function baseFontSize(kind: BalloonKind, boxW: number, scale: number): number {
  return kind === 'sfx'
    ? Math.max(20 * scale, boxW * 0.19)
    : Math.max(11 * scale, Math.min(boxW * 0.115, 15 * scale))
}

/**
 * Where a balloon lands and how its text is set.
 *
 * A panel is clipped when it is drawn, so lettering that does not fit is not
 * merely ugly — it disappears. Long lettering therefore widens toward the
 * panel first, the way a letterer reaches for more width before touching the
 * type size, and only shrinks the type once there is no width left. The centre
 * is then held inside the panel, so a balloon placed near an edge slides in
 * rather than being cut in half.
 */
export function layoutBalloon(
  ctx: CanvasRenderingContext2D, balloon: Balloon, panel: Rect, scale: number,
): BalloonLayout {
  const text = balloon.text.trim() || '…'
  const shown = balloon.kind === 'sfx' ? text.toUpperCase() : text
  const weight = balloon.kind === 'shout' || balloon.kind === 'sfx' ? '700' : '400'

  // A letterer keeps the balloon off the border; so does this.
  const inset = Math.max(3 * scale, Math.min(panel.w, panel.h) * 0.025)
  const maxW = Math.max(24 * scale, panel.w - inset * 2)
  const maxH = Math.max(24 * scale, panel.h - inset * 2)

  const measure = (boxW: number, fontSize: number) => {
    const font = `${weight} ${fontSize}px ${LETTERING}`
    ctx.font = font
    const padding = fontSize * (balloon.kind === 'caption' ? 0.7 : 0.95)
    const inner = Math.max(fontSize, boxW - padding * 2)
    const { lines, broke } = wrapText(ctx, shown, inner)
    const lineHeight = fontSize * 1.28
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1)
    return {
      font, lines, padding, lineHeight, fontSize, broke,
      w: Math.min(inner, widest) + padding * 2,
      h: lines.length * lineHeight + padding * 2,
    }
  }

  const wanted = Math.min(maxW, Math.max(40 * scale, balloon.width * panel.w))
  let boxW = wanted
  let fontSize = baseFontSize(balloon.kind, wanted, scale)
  let box = measure(boxW, fontSize)
  // A word that had to be split is a fit problem too — and for a sound effect,
  // whose type is sized from its own box, shrinking is the only thing that
  // helps: widening grows the lettering in step and never closes the gap.
  const overflows = (): boolean => box.h > maxH || box.broke
  // Short lettering keeps exactly the width the writer chose; only a balloon
  // that has run tall reaches for more.
  const tooTall = (): boolean => box.h > box.w * TALL_LIMIT

  for (let i = 0; (overflows() || tooTall()) && boxW < maxW && i < FIT_STEPS; i++) {
    boxW = Math.min(maxW, boxW * 1.2)
    box = measure(boxW, fontSize)
  }
  for (let i = 0; overflows() && fontSize > MIN_FONT * scale && i < FIT_STEPS; i++) {
    fontSize = Math.max(MIN_FONT * scale, fontSize * 0.9)
    box = measure(boxW, fontSize)
  }

  const w = box.w
  const h = box.h
  return {
    cx: clampTo(panel.x + balloon.x * panel.w, panel.x + inset + w / 2, panel.x + panel.w - inset - w / 2),
    cy: clampTo(panel.y + balloon.y * panel.h, panel.y + inset + h / 2, panel.y + panel.h - inset - h / 2),
    w,
    h,
    font: box.font,
    fontSize: box.fontSize,
    lineHeight: box.lineHeight,
    padding: box.padding,
    lines: box.lines,
  }
}

/**
 * A context kept only for measuring text outside a draw, so the editor can put
 * a balloon's drag handle exactly where the balloon is rendered.
 */
let measuring: CanvasRenderingContext2D | null | undefined

export function balloonPlacement(
  balloon: Balloon, panel: Rect, scale: number,
): { cx: number; cy: number } | null {
  if (measuring === undefined) {
    measuring = typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d')
  }
  if (!measuring) return null
  const { cx, cy } = layoutBalloon(measuring, balloon, panel, scale)
  return { cx, cy }
}

function drawBalloon(ctx: CanvasRenderingContext2D, balloon: Balloon, panel: Rect, scale: number): void {
  const { cx, cy, w, h, font, fontSize, lineHeight, padding, lines } =
    layoutBalloon(ctx, balloon, panel, scale)

  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const x = cx - w / 2
  const y = cy - h / 2

  const tailX = panel.x + balloon.tailX * panel.w
  const tailY = panel.y + balloon.tailY * panel.h
  const stroke = Math.max(1, 1.7 * scale)

  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.fillStyle = PAPER
  ctx.lineWidth = stroke

  switch (balloon.kind) {
    case 'sfx':
      // No container: outlined display lettering sitting straight on the art.
      ctx.lineWidth = Math.max(2, fontSize * 0.16)
      ctx.strokeStyle = '#ffffff'
      ctx.fillStyle = INK
      lines.forEach((line, i) => {
        const ly = y + padding + i * lineHeight + lineHeight / 2
        ctx.strokeText(line, cx, ly)
        ctx.fillText(line, cx, ly)
      })
      return

    case 'caption':
      ctx.fillStyle = '#fdf6e3'
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
      break

    case 'thought':
      cloud(ctx, x, y, w, h)
      ctx.fill()
      ctx.stroke()
      // Trailing bubbles stand in for the speech tail.
      // Sized off the balloon so the trail stays legible at any panel scale.
      for (const [t, r] of [[0.52, 0.13], [0.74, 0.09], [0.92, 0.058]] as const) {
        ctx.beginPath()
        ctx.arc(cx + (tailX - cx) * t, cy + (tailY - cy) * t, Math.max(2.5, Math.min(w, h * 1.6) * r), 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      break

    case 'shout':
      burst(ctx, x, y, w, h)
      ctx.fill()
      ctx.stroke()
      // The burst's spikes reach past the ellipse, so the tail starts outside
      // them — otherwise its flanks surface in the notches as stray marks.
      drawTail(ctx, cx, cy, w, h, tailX, tailY, stroke, 1.14)
      break

    default:
      roundedRect(ctx, x, y, w, h, h / 2.6)
      ctx.fill()
      ctx.stroke()
      drawTail(ctx, cx, cy, w, h, tailX, tailY, stroke)
  }

  ctx.fillStyle = INK
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, y + padding + i * lineHeight + lineHeight / 2)
  })
}

/** A tapered pointer from the balloon body toward the speaker. */
function drawTail(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, w: number, h: number,
  tailX: number, tailY: number, stroke: number,
  /** Push the base outward for shapes that reach past their ellipse. */
  baseScale = 1,
): void {
  const dx = tailX - cx
  const dy = tailY - cy
  const distance = Math.hypot(dx, dy)
  // A tail pointing inside the balloon would just be a smudge.
  if (distance < Math.max(w, h) * 0.45) return

  const angle = Math.atan2(dy, dx)
  // The base is an arc of the balloon's own ellipse, so it stays broad however
  // wide or flat the balloon is — measuring it off the smaller edge collapses
  // the tail into a needle on a wide balloon.
  const spread = 0.5
  const rx = (w / 2) * baseScale
  const ry = (h / 2) * baseScale
  const p1x = cx + Math.cos(angle - spread) * rx
  const p1y = cy + Math.sin(angle - spread) * ry
  const p2x = cx + Math.cos(angle + spread) * rx
  const p2y = cy + Math.sin(angle + spread) * ry

  // Bow the flanks slightly for a hand-drawn taper. The offset runs along the
  // unit perpendicular: scaling it by the raw tail vector makes long tails
  // swing far enough that the two flanks cross over each other.
  const bow = distance * 0.05
  const px = -dy / distance
  const py = dx / distance
  const c1x = (p1x + tailX) / 2 + px * bow
  const c1y = (p1y + tailY) / 2 + py * bow
  const c2x = (p2x + tailX) / 2 - px * bow
  const c2y = (p2y + tailY) / 2 - py * bow

  ctx.beginPath()
  ctx.moveTo(p1x, p1y)
  ctx.quadraticCurveTo(c1x, c1y, tailX, tailY)
  ctx.quadraticCurveTo(c2x, c2y, p2x, p2y)
  ctx.closePath()
  ctx.fill()

  // Stroke only the two flanks, leaving the mouth open into the balloon body.
  ctx.beginPath()
  ctx.moveTo(p1x, p1y)
  ctx.quadraticCurveTo(c1x, c1y, tailX, tailY)
  ctx.quadraticCurveTo(c2x, c2y, p2x, p2y)
  ctx.lineWidth = stroke
  ctx.stroke()
}

// ── Artwork ──────────────────────────────────────────────────────────────────

/**
 * Cover-fit the artwork in its frame, then apply the panel's zoom and pan.
 * Returns the source rectangle to sample from the image.
 */
export function sourceRect(
  panel: Panel,
  image: { naturalWidth: number; naturalHeight: number },
  rect: Rect,
): { sx: number; sy: number; sw: number; sh: number } {
  const iw = image.naturalWidth
  const ih = image.naturalHeight
  const cover = Math.max(rect.w / iw, rect.h / ih)
  const scale = cover * Math.max(1, panel.zoom)
  const sw = Math.min(iw, rect.w / scale)
  const sh = Math.min(ih, rect.h / scale)
  const slackX = iw - sw
  const slackY = ih - sh
  const clamp = (v: number): number => Math.min(1, Math.max(0, v))
  return {
    sx: clamp((panel.offsetX + 1) / 2) * slackX,
    sy: clamp((panel.offsetY + 1) / 2) * slackY,
    sw,
    sh,
  }
}

export function drawPage(
  ctx: CanvasRenderingContext2D,
  page: Page,
  images: Map<string, HTMLImageElement>,
  opts: RenderOptions,
): void {
  const geo = pageGeometry(opts)
  const scale = geo.width / 1000
  const border = opts.border ?? Math.max(1.5, 2.4 * scale)

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, geo.width, geo.height)

  const frames = layoutOf(page.layout).frames
  page.panels.forEach((panel, i) => {
    const frame = frames[i]
    if (!frame) return
    const rect = frameToRect(frame, geo)

    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.w, rect.h)
    ctx.clip()

    const image = panel.assetId ? images.get(panel.assetId) : undefined
    if (image) {
      const { sx, sy, sw, sh } = sourceRect(panel, image, rect)
      ctx.drawImage(image, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)
    } else {
      ctx.fillStyle = EMPTY_PANEL
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    }

    for (const balloon of panel.balloons) drawBalloon(ctx, balloon, rect, scale)
    ctx.restore()

    if (border > 0) {
      ctx.strokeStyle = INK
      ctx.lineWidth = border
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
    }
  })
}

/** Render one page to an offscreen canvas — the basis of both exports. */
export function renderPage(
  page: Page,
  images: Map<string, HTMLImageElement>,
  opts: RenderOptions,
): HTMLCanvasElement {
  const geo = pageGeometry(opts)
  const canvas = document.createElement('canvas')
  canvas.width = geo.width
  canvas.height = geo.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not render the page.')
  drawPage(ctx, page, images, opts)
  return canvas
}

export function assetIdsOf(pages: Page[]): string[] {
  return pages.flatMap((p) => p.panels.map((panel) => panel.assetId).filter((id): id is string => !!id))
}
