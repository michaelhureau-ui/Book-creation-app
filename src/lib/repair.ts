import type { Balloon, Book, Chapter, Page, Panel } from '@/types'
import { createProsePage, groupPages, newId } from '@/lib/book'
import { layoutOf } from '@/lib/graphic/layouts'

/**
 * Putting a book right.
 *
 * A book is edited for weeks, written by a service that sometimes stops
 * answering half way, carried on, duplicated, exported and imported again. Any
 * of that can leave something not quite right in it: a page belonging to a
 * chapter that was deleted, a balloon off the edge of its panel, a panel
 * pointing at artwork that is no longer there, two pages sharing an id after a
 * bad import. Most of it is invisible until something looks wrong on the page
 * and there is nothing to be done about it.
 *
 * This walks the whole book and fixes what it can, and — importantly — says
 * what it fixed. It never deletes anybody's writing: a balloon with no words
 * in it is emptied of nothing, a chapter with no pages keeps a blank page so
 * it can still be typed into.
 */
export interface Repair {
  /** What was wrong, in plain words, one line per kind of fault. */
  notes: string[]
  book: Book
}

/** A number that has to be a fraction of a panel, whatever it says now. */
function fraction(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

const BALLOON_KINDS = new Set(['speech', 'thought', 'caption', 'shout', 'sfx'])

/**
 * Repair a book.
 *
 * `assets` is the set of artwork ids that really exist. A panel pointing at
 * one that does not is emptied, which is what lets it be drawn again — that
 * particular fault is why a page can come out blank with no way to fix it.
 */
export function repairBook(book: Book, assets?: Set<string>): Repair {
  const notes: string[] = []
  const count = new Map<string, number>()
  const tally = (note: string): void => { count.set(note, (count.get(note) ?? 0) + 1) }

  const usedIds = new Set<string>()
  const freshId = (id: unknown, what: string): string => {
    const text = typeof id === 'string' && id.trim() ? id : ''
    if (!text || usedIds.has(text)) {
      tally(`${what} with a missing or repeated id`)
      const made = newId()
      usedIds.add(made)
      return made
    }
    usedIds.add(text)
    return text
  }

  const chapters: Chapter[] = (Array.isArray(book.chapters) ? book.chapters : []).map((chapter) => {
    const id = freshId(chapter?.id, 'A chapter')
    const pages = Array.isArray(chapter?.pages) ? chapter.pages : []
    if (!Array.isArray(chapter?.pages)) tally('A chapter with nothing in it')
    return {
      ...chapter,
      id,
      kind: chapter?.kind === 'front' || chapter?.kind === 'back' ? chapter.kind : 'chapter',
      title: typeof chapter?.title === 'string' ? chapter.title : '',
      pages: pages.length > 0 ? pages : [createProsePage()],
    }
  })

  const known = new Set(chapters.map((c) => c.id))

  const fixBalloon = (balloon: Balloon): Balloon => {
    const id = freshId(balloon?.id, 'A balloon')
    const width = fraction(balloon?.width, 0.5) || 0.5
    const kind = BALLOON_KINDS.has(balloon?.kind as string) ? balloon.kind : 'speech'
    if (!BALLOON_KINDS.has(balloon?.kind as string)) tally('A balloon of no known kind')
    const x = fraction(balloon?.x, 0.5)
    const y = fraction(balloon?.y, 0.2)
    if (!Number.isFinite(balloon?.x) || !Number.isFinite(balloon?.y)) {
      tally('A balloon with no position')
    } else if (balloon.x < 0 || balloon.x > 1 || balloon.y < 0 || balloon.y > 1) {
      tally('A balloon off the edge of its panel')
    }
    return {
      ...balloon,
      id,
      kind,
      text: typeof balloon?.text === 'string' ? balloon.text : '',
      width: Math.min(0.96, Math.max(0.08, width)),
      x,
      y,
      tailX: fraction(balloon?.tailX, x),
      tailY: fraction(balloon?.tailY, y),
    }
  }

  const fixPanel = (panel: Panel): Panel => {
    const id = freshId(panel?.id, 'A panel')
    let assetId = typeof panel?.assetId === 'string' ? panel.assetId : null
    if (assetId && assets && !assets.has(assetId)) {
      // The artwork is gone. Keeping the id makes a panel that is permanently
      // blank and cannot be redrawn; clearing it makes it an empty panel
      // again, which Draw will fill.
      tally('A panel pointing at artwork that is no longer there')
      assetId = null
    }
    const band = Number(panel?.letterBand)
    return {
      ...panel,
      id,
      assetId,
      zoom: Number.isFinite(panel?.zoom) && panel.zoom >= 1 ? panel.zoom : 1,
      offsetX: Number.isFinite(panel?.offsetX) ? Math.min(1, Math.max(-1, panel.offsetX)) : 0,
      offsetY: Number.isFinite(panel?.offsetY) ? Math.min(1, Math.max(-1, panel.offsetY)) : 0,
      ...(Number.isFinite(band) && band > 0 ? { letterBand: Math.min(0.6, band) } : {}),
      balloons: (Array.isArray(panel?.balloons) ? panel.balloons : []).map(fixBalloon),
    }
  }

  const pages: Page[] = (Array.isArray(book.pages) ? book.pages : []).map((page) => {
    const id = freshId(page?.id, 'A page')
    const layout = layoutOf(page?.layout)
    const frames = layout.frames.length
    const panels = (Array.isArray(page?.panels) ? page.panels : []).map(fixPanel)
    if (panels.length > frames) {
      // More panels than the layout can draw: the extra ones are invisible,
      // which looks like lost work. A layout that fits them keeps them.
      tally('A page with more panels than its layout could show')
    }
    const chapterId = typeof page?.chapterId === 'string' && known.has(page.chapterId)
      ? page.chapterId
      : null
    if (page?.chapterId && !known.has(page.chapterId)) {
      tally('A page belonging to a chapter that is gone')
    }
    return { ...page, id, chapterId, panels }
  })

  // Pages that outgrew their layout get one that fits, largest first.
  const widened = pages.map((page) => {
    const frames = layoutOf(page.layout).frames.length
    if (page.panels.length <= frames) return page
    // The smallest layout that fits, so the panels get as much room as they can.
    for (const candidate of ['two-rows', 'three-rows', 'four-grid', 'six-grid'] as const) {
      if (layoutOf(candidate).frames.length >= page.panels.length) {
        return { ...page, layout: candidate }
      }
    }
    return page
  })

  for (const [note, times] of count) {
    notes.push(times === 1 ? note : `${note} (${times} of them)`)
  }

  return {
    notes,
    book: {
      ...book,
      chapters,
      // groupPages is what keeps each chapter's own list and the book's flat
      // list of pages telling the same story.
      pages: groupPages(chapters, widened),
    },
  }
}
