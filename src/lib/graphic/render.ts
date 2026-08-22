import type { Balloon, Page, Panel } from '@/types'
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

/** Greedy wrap that also honours the line breaks the writer typed. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
  }
  return lines
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

interface Rect { x: number; y: number; w: number; h: number }

function drawBalloon(ctx: CanvasRenderingContext2D, balloon: Balloon, panel: Rect, scale: number): void {
  const text = balloon.text.trim() || '…'
  const boxW = Math.max(40 * scale, balloon.width * panel.w)
  const fontSize = balloon.kind === 'sfx'
    ? Math.max(20 * scale, boxW * 0.19)
    : Math.max(11 * scale, Math.min(boxW * 0.115, 15 * scale))

  const weight = balloon.kind === 'shout' || balloon.kind === 'sfx' ? '700' : '400'
  ctx.font = `${weight} ${fontSize}px ${LETTERING}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const padding = fontSize * (balloon.kind === 'caption' ? 0.7 : 0.95)
  const lines = wrapText(ctx, balloon.kind === 'sfx' ? text.toUpperCase() : text, boxW - padding * 2)
  const lineHeight = fontSize * 1.28
  const textW = Math.min(boxW - padding * 2, Math.max(...lines.map((l) => ctx.measureText(l).width), 1))
  const boxH = lines.length * lineHeight + padding * 2

  const cx = panel.x + balloon.x * panel.w
  const cy = panel.y + balloon.y * panel.h
  const w = textW + padding * 2
  const h = boxH
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
