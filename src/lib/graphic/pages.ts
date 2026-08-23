import type { Balloon, BalloonKind, Page, PageLayoutId, Panel } from '@/types'
import { newId } from '@/lib/book'
import { panelCount } from '@/lib/graphic/layouts'

export function createPanel(): Panel {
  return { id: newId(), assetId: null, zoom: 1, offsetX: 0, offsetY: 0, balloons: [] }
}

export function createPage(
  layout: PageLayoutId = 'four-grid',
  title = 'New page',
  chapterId: string | null = null,
): Page {
  return {
    id: newId(),
    title,
    layout,
    chapterId,
    panels: Array.from({ length: panelCount(layout) }, createPanel),
  }
}

const BALLOON_DEFAULTS: Record<BalloonKind, Partial<Balloon>> = {
  speech: { x: 0.32, y: 0.2, width: 0.42, tailX: 0.45, tailY: 0.62 },
  thought: { x: 0.34, y: 0.22, width: 0.42, tailX: 0.5, tailY: 0.68 },
  caption: { x: 0.3, y: 0.12, width: 0.5, tailX: 0.3, tailY: 0.12 },
  shout: { x: 0.5, y: 0.28, width: 0.4, tailX: 0.55, tailY: 0.7 },
  sfx: { x: 0.5, y: 0.5, width: 0.45, tailX: 0.5, tailY: 0.5 },
}

const BALLOON_TEXT: Record<BalloonKind, string> = {
  speech: 'Say something.',
  thought: 'Wonder something…',
  caption: 'Later that night…',
  shout: 'Look out!',
  sfx: 'Krakoom',
}

export function createBalloon(kind: BalloonKind): Balloon {
  return {
    id: newId(),
    kind,
    text: BALLOON_TEXT[kind],
    x: 0.5, y: 0.25, width: 0.4, tailX: 0.5, tailY: 0.7,
    ...BALLOON_DEFAULTS[kind],
  }
}

/**
 * Changing a layout keeps the artwork already placed: panels are matched by
 * position, extra ones are dropped, and missing ones are added empty.
 */
export function applyLayout(page: Page, layout: PageLayoutId): Page {
  const wanted = panelCount(layout)
  const panels = Array.from({ length: wanted }, (_, i) => page.panels[i] ?? createPanel())
  return { ...page, layout, panels }
}

/** Panels whose artwork is no longer referenced anywhere in the book. */
export function orphanedAssets(pages: Page[], removed: string[]): string[] {
  const live = new Set(
    pages.flatMap((p) => p.panels.map((panel) => panel.assetId).filter((id): id is string => !!id)),
  )
  return removed.filter((id) => !live.has(id))
}

export const BALLOON_LABELS: Record<BalloonKind, string> = {
  speech: 'Speech',
  thought: 'Thought',
  caption: 'Caption',
  shout: 'Shout',
  sfx: 'Sound effect',
}

/** Rewrite panel asset ids through a remap — used after duplicating artwork. */
export function remapAssets(pages: Page[], remap: Map<string, string>): Page[] {
  if (remap.size === 0) return pages
  return pages.map((page) => ({
    ...page,
    panels: page.panels.map((panel) => ({
      ...panel,
      assetId: panel.assetId ? remap.get(panel.assetId) ?? panel.assetId : null,
    })),
  }))
}
