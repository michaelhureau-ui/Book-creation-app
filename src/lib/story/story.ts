import type {
  Balloon, BalloonKind, Book, BookKind, Chapter, Page, PageLayoutId, Panel,
} from '@/types'
import { createBook, createChapter, createProsePage, newId } from '@/lib/book'
import { createBalloon, createPanel } from '@/lib/graphic/pages'
import { LAYOUTS, panelCount } from '@/lib/graphic/layouts'

export type StoryKind = BookKind
export type StoryLength = 'short' | 'medium' | 'long'

export interface OutlineChapter {
  title: string
  summary: string
}

/** One character, described so every panel can be drawn the same way. */
export interface CastMember {
  name: string
  look: string
}

export interface Outline {
  title: string
  subtitle: string
  cast: CastMember[]
  chapters: OutlineChapter[]
}

/**
 * Everything below reads the model's reply defensively. It is generated text,
 * not an API contract: a missing field or the wrong type is a Tuesday, and the
 * book should still come out rather than the app throwing.
 */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function readOutline(raw: unknown): Outline {
  const body = (raw ?? {}) as {
    title?: unknown; subtitle?: unknown; cast?: unknown; chapters?: unknown
  }
  const cast = list(body.cast)
    .map((c) => {
      const entry = (c ?? {}) as { name?: unknown; look?: unknown }
      return { name: str(entry.name), look: str(entry.look) }
    })
    .filter((c) => c.name.length > 0)
  const chapters = list(body.chapters)
    .map((c, i) => {
      const entry = (c ?? {}) as { title?: unknown; summary?: unknown }
      return { title: str(entry.title, `Chapter ${i + 1}`), summary: str(entry.summary) }
    })
    .filter((c) => c.title.length > 0)
  return {
    title: str(body.title, 'Untitled book'),
    subtitle: str(body.subtitle),
    cast,
    chapters: chapters.length > 0 ? chapters : [{ title: 'Chapter One', summary: '' }],
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Paragraphs become the TipTap HTML the editor and every exporter already read. */
export function paragraphsToHtml(paragraphs: string[]): string {
  const written = paragraphs.map((p) => p.trim()).filter(Boolean)
  if (written.length === 0) return ''
  return written.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
}

/** The written pages of one prose chapter. Always at least one. */
export function readProsePages(raw: unknown): string[] {
  const body = (raw ?? {}) as { pages?: unknown }
  const pages = list(body.pages)
    .map((page) => {
      const entry = (page ?? {}) as { paragraphs?: unknown; text?: unknown }
      // A model that ignores the shape usually hands back one string instead.
      const paragraphs = Array.isArray(entry.paragraphs)
        ? entry.paragraphs.map((p) => str(p))
        : str(entry.text).split(/\n{2,}/)
      return paragraphsToHtml(paragraphs)
    })
    .filter((html) => html.length > 0)
  return pages.length > 0 ? pages : ['']
}

const BALLOON_KINDS: BalloonKind[] = ['speech', 'thought', 'caption', 'shout', 'sfx']

/** The nearest layout to the number of panels written, never fewer frames. */
export function layoutForPanels(count: number): PageLayoutId {
  const wanted = Math.max(1, count)
  let best: PageLayoutId = 'four-grid'
  let bestDistance = Infinity
  for (const layout of LAYOUTS) {
    const frames = panelCount(layout.id)
    // A layout with too few frames would drop panels that were written.
    const distance = frames >= wanted ? frames - wanted : Infinity
    if (distance < bestDistance) { bestDistance = distance; best = layout.id }
  }
  return bestDistance === Infinity ? 'six-grid' : best
}

export interface WrittenPage {
  title: string
  layout: PageLayoutId
  panels: { note: string; balloons: Balloon[] }[]
}

export function readGraphicPages(raw: unknown): WrittenPage[] {
  const body = (raw ?? {}) as { pages?: unknown }
  const pages = list(body.pages).map((page, i) => {
    const entry = (page ?? {}) as { title?: unknown; panels?: unknown }
    const panels = list(entry.panels).map((panel) => {
      const cell = (panel ?? {}) as { art?: unknown; description?: unknown; balloons?: unknown }
      const balloons = list(cell.balloons)
        .map((b) => {
          const raw = (b ?? {}) as { kind?: unknown; text?: unknown }
          const text = str(raw.text)
          if (!text) return null
          const kind = BALLOON_KINDS.includes(raw.kind as BalloonKind)
            ? (raw.kind as BalloonKind)
            : 'speech'
          return { ...createBalloon(kind), text }
        })
        .filter((b): b is Balloon => b !== null)
      return { note: str(cell.art) || str(cell.description), balloons }
    })
    return {
      title: str(entry.title, `Page ${i + 1}`),
      layout: layoutForPanels(panels.length),
      panels,
    }
  })
  return pages.filter((p) => p.panels.length > 0)
}

/** Lay the written balloons out down the page so they do not land on top of each other. */
function placeBalloons(balloons: Balloon[]): Balloon[] {
  return balloons.map((balloon, i) => {
    const step = 1 / (balloons.length + 1)
    return { ...balloon, y: step * (i + 1) * 0.8, tailY: Math.min(0.92, step * (i + 1) * 0.8 + 0.4) }
  })
}

export function buildGraphicPage(page: WrittenPage, chapterId: string): Page {
  const frames = panelCount(page.layout)
  const panels: Panel[] = Array.from({ length: frames }, (_, i) => {
    const written = page.panels[i]
    if (!written) return createPanel()
    return { ...createPanel(), note: written.note, balloons: placeBalloons(written.balloons) }
  })
  return { id: newId(), title: page.title, layout: page.layout, chapterId, panels }
}

export function buildProseChapter(title: string, pages: string[]): Chapter {
  const chapter = createChapter('chapter', title)
  chapter.pages = pages.map((html) => createProsePage(html))
  if (chapter.pages.length === 0) chapter.pages = [createProsePage()]
  return chapter
}

/** The empty book a story is poured into, before any chapter has been written. */
export function startBook(outline: Outline, kind: StoryKind): Book {
  const book = createBook(outline.title || 'Untitled book', '', kind)
  book.subtitle = outline.subtitle
  book.chapters = []
  book.pages = []
  return book
}
