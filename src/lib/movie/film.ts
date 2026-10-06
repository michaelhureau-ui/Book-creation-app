import type { Balloon, Book, Page, Panel } from '@/types'
import { chapterNumbers } from '@/lib/book'
import { frameToRect, layoutOf } from '@/lib/graphic/layouts'
import { pageGeometry } from '@/lib/graphic/render'

/** The shape of the screen the film is watched on. */
export const FRAME_ASPECT = 1280 / 720

export type MotionStyle = 'panels' | 'pages'

/** Where a shot's frame starts and ends, as a fraction of the source. */
export interface Move {
  from: { x: number; y: number; scale: number }
  to: { x: number; y: number; scale: number }
}

export type Shot =
  | { kind: 'cover'; seconds: number; title: string; subtitle: string; author: string }
  | { kind: 'chapter'; seconds: number; title: string; number?: number }
  | {
    kind: 'panel'
    seconds: number
    page: Page
    panelIndex: number
    panel: Panel
    balloons: Balloon[]
    move: Move
  }
  | { kind: 'page'; seconds: number; page: Page; move: Move }
  | { kind: 'text'; seconds: number; lines: string[]; title: string }
  | { kind: 'end'; seconds: number; title: string }

export interface FilmOptions {
  motion: MotionStyle
  /** How long one panel or page is held, in seconds. */
  pace: number
}

export const DEFAULT_FILM: FilmOptions = { motion: 'panels', pace: 2.6 }

/**
 * How the camera travels over one picture.
 *
 * A panel is cropped to fill a wide screen, so a tall one shown dead centre
 * loses its top and bottom — which on a comic page is usually a character's
 * head. So a tall picture is travelled down and a very wide one across, and
 * only something near the shape of the screen gets a plain push in. The push
 * alternates direction so a run of shots does not pulse.
 */
export function moveFor(index: number, aspect: number): Move {
  if (aspect < FRAME_ASPECT * 0.78) {
    return { from: { x: 0.5, y: 0.2, scale: 1 }, to: { x: 0.5, y: 0.8, scale: 1.04 } }
  }
  if (aspect > FRAME_ASPECT * 1.6) {
    const rightward = index % 2 === 0
    return {
      from: { x: rightward ? 0.2 : 0.8, y: 0.5, scale: 1 },
      to: { x: rightward ? 0.8 : 0.2, y: 0.5, scale: 1.04 },
    }
  }
  const drift = index % 2 === 0 ? 1 : -1
  return {
    from: { x: 0.5 - 0.012 * drift, y: 0.5, scale: 1 },
    to: { x: 0.5 + 0.012 * drift, y: 0.5, scale: 1.08 },
  }
}

/** The shape of one panel on the page, in the units the renderer draws in. */
export function panelAspectOf(page: Page, index: number): number {
  const frame = layoutOf(page.layout).frames[index]
  if (!frame) return FRAME_ASPECT
  const rect = frameToRect(frame, pageGeometry({ trim: 'comic', dpi: 150 }))
  return rect.h > 0 ? rect.w / rect.h : FRAME_ASPECT
}

/**
 * Reading a book aloud takes longer than looking at it, so lettering buys the
 * shot more time — but a wordless panel should not linger either.
 */
export function holdFor(pace: number, balloons: Balloon[]): number {
  const words = balloons.reduce((n, b) => n + b.text.trim().split(/\s+/).filter(Boolean).length, 0)
  // Roughly three words a second, on top of the time the picture itself needs.
  return Math.min(pace * 3, pace + words / 3)
}

/**
 * The shot list for a book.
 *
 * Deciding this apart from the recorder keeps the grammar of the film — what is
 * shown, in what order, for how long — testable without a canvas, and keeps the
 * recorder to the one job of drawing it.
 */
export function shotList(book: Book, options: FilmOptions = DEFAULT_FILM): Shot[] {
  const pace = Math.max(0.6, options.pace)
  const shots: Shot[] = [{
    kind: 'cover',
    seconds: Math.max(2.2, pace),
    title: book.title.trim() || 'Untitled book',
    subtitle: book.subtitle.trim(),
    author: book.author.trim() || 'Anonymous',
  }]

  const numbers = chapterNumbers(book.chapters)

  if (book.kind === 'graphic') {
    let chapterSeen: string | null | undefined
    book.pages.forEach((page, pageIndex) => {
      const chapter = book.chapters.find((c) => c.id === page.chapterId)
      if (page.chapterId !== chapterSeen) {
        chapterSeen = page.chapterId
        if (chapter) {
          shots.push({
            kind: 'chapter',
            seconds: Math.max(1.6, pace * 0.7),
            title: chapter.title || 'Untitled chapter',
            number: numbers.get(chapter.id),
          })
        }
      }

      if (options.motion === 'pages') {
        const geo = pageGeometry({ trim: 'comic', dpi: 150 })
        shots.push({
          kind: 'page',
          seconds: Math.max(1.4, pace),
          page,
          move: moveFor(pageIndex, geo.width / geo.height),
        })
        return
      }

      const frames = layoutOf(page.layout).frames
      page.panels.forEach((panel, panelIndex) => {
        if (!frames[panelIndex]) return
        shots.push({
          kind: 'panel',
          seconds: holdFor(pace, panel.balloons),
          page,
          panelIndex,
          panel,
          balloons: panel.balloons,
          move: moveFor(panelIndex, panelAspectOf(page, panelIndex)),
        })
      })
    })
  } else {
    for (const chapter of book.chapters) {
      shots.push({
        kind: 'chapter',
        seconds: Math.max(1.6, pace * 0.7),
        title: chapter.title || 'Untitled chapter',
        number: numbers.get(chapter.id),
      })
    }
  }

  shots.push({ kind: 'end', seconds: Math.max(1.8, pace), title: book.title.trim() || 'Untitled book' })
  return shots
}

/**
 * Hold each shot for at least as long as its narration takes.
 *
 * A shot that ends before its line does is the reason the voice kept being cut
 * off mid-sentence: the film ran to the clock and the words ran to their own
 * length. Reconciling them before filming is what fixes it.
 */
export function stretchShots(shots: Shot[], minimums: number[]): Shot[] {
  return shots.map((shot, i) => {
    const needed = minimums[i] ?? 0
    return needed > shot.seconds ? { ...shot, seconds: needed } : shot
  })
}

export function filmSeconds(shots: Shot[]): number {
  return shots.reduce((total, shot) => total + shot.seconds, 0)
}

/** Which shot is on screen at `time`, and how far through it we are. */
export function shotAt(shots: Shot[], time: number): { shot: Shot; progress: number } | null {
  let start = 0
  for (const shot of shots) {
    if (time < start + shot.seconds) {
      return { shot, progress: shot.seconds > 0 ? (time - start) / shot.seconds : 0 }
    }
    start += shot.seconds
  }
  return null
}

/** Ease so a push-in starts and ends gently rather than snapping into motion. */
export function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped < 0.5
    ? 2 * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 2) / 2
}
