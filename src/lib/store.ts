import { create } from 'zustand'
import type {
  Balloon, BalloonKind, Book, BookKind, Chapter, ChapterKind, Cover, Page, PageLayoutId, Panel,
  ProsePage,
} from '@/types'
import {
  createBook, createChapter, createProsePage, duplicateBook, groupPages, move, newId, normalizeBook,
  stepPage,
} from '@/lib/book'
import { applyLayout, createBalloon, createPage, orphanedAssets, remapAssets } from '@/lib/graphic/pages'
import { duplicateAssets, removeAsset } from '@/lib/graphic/assets'
import * as db from '@/lib/db'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface State {
  books: Book[]
  loading: boolean
  loadError: string | null
  /** null = library view. */
  openBookId: string | null
  openChapterId: string | null
  /** Novels: the page of the open chapter that the editor is showing. */
  openProsePageId: string | null
  /** Graphic novels: the page being edited, and the selected panel within it. */
  openPageId: string | null
  selectedPanelId: string | null
  selectedBalloonId: string | null
  saveState: SaveState

  load: () => Promise<void>
  openBook: (id: string) => void
  closeBook: () => void
  selectChapter: (id: string) => void
  selectProsePage: (id: string) => void
  selectPage: (id: string) => void
  selectPanel: (id: string | null) => void
  selectBalloon: (id: string | null) => void

  addBook: (title?: string, author?: string, kind?: BookKind) => Promise<string>
  copyBook: (id: string) => Promise<void>
  removeBook: (id: string) => Promise<void>
  importBook: (book: Book) => Promise<string>

  updateBook: (id: string, patch: Partial<Omit<Book, 'id' | 'chapters'>>) => void
  updateCover: (id: string, patch: Partial<Cover>) => void

  addChapter: (bookId: string, kind?: ChapterKind) => void
  updateChapter: (bookId: string, chapterId: string, patch: Partial<Omit<Chapter, 'id' | 'pages'>>) => void
  removeChapter: (bookId: string, chapterId: string) => void
  moveChapter: (bookId: string, from: number, to: number) => void

  /** Append a written chapter, and any comic pages belonging to it. */
  addStoryChapter: (bookId: string, chapter: Chapter, pages: Page[]) => void

  addProsePage: (bookId: string, chapterId: string) => void
  updateProsePage: (bookId: string, chapterId: string, pageId: string, content: string) => void
  removeProsePage: (bookId: string, chapterId: string, pageId: string) => void
  moveProsePage: (bookId: string, chapterId: string, from: number, to: number) => void

  addPage: (bookId: string, layout?: PageLayoutId, chapterId?: string | null) => void
  updatePage: (bookId: string, pageId: string, patch: Partial<Omit<Page, 'id'>>) => void
  setPageLayout: (bookId: string, pageId: string, layout: PageLayoutId) => void
  removePage: (bookId: string, pageId: string) => void
  /** Nudge a page one step through the book; crossing a chapter edge refiles it. */
  movePage: (bookId: string, pageId: string, delta: -1 | 1) => void
  setPageChapter: (bookId: string, pageId: string, chapterId: string | null) => void

  updatePanel: (bookId: string, pageId: string, panelId: string, patch: Partial<Omit<Panel, 'id' | 'balloons'>>) => void
  setPanelArt: (bookId: string, pageId: string, panelId: string, assetId: string) => void
  clearPanelArt: (bookId: string, pageId: string, panelId: string) => void

  addBalloon: (bookId: string, pageId: string, panelId: string, kind: BalloonKind) => void
  /** Replace a panel's lettering wholesale, as fitting it to the artwork does. */
  setPanelBalloons: (
    bookId: string, pageId: string, panelId: string, balloons: Balloon[], letterBand?: number,
  ) => void
  updateBalloon: (bookId: string, pageId: string, panelId: string, balloonId: string, patch: Partial<Omit<Balloon, 'id'>>) => void
  removeBalloon: (bookId: string, pageId: string, panelId: string, balloonId: string) => void
}

/**
 * Edits land in memory immediately and flush to IndexedDB on a short debounce,
 * so typing never waits on a write. Each book has its own timer — saving one
 * book must not cancel a pending save of another.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_DELAY = 500

function scheduleSave(book: Book, set: (partial: Partial<State>) => void): void {
  const existing = timers.get(book.id)
  if (existing) clearTimeout(existing)
  set({ saveState: 'saving' })
  timers.set(
    book.id,
    setTimeout(() => {
      timers.delete(book.id)
      db.saveBook(book)
        .then(() => set({ saveState: 'saved' }))
        .catch(() => set({ saveState: 'error' }))
    }, SAVE_DELAY),
  )
}

export const useStore = create<State>((set, get) => {
  /**
   * Apply a change to one book, stamp updatedAt, and queue the save. Every
   * edit re-groups the graphic pages, so no action has to remember on its own
   * that pages are stored in chapter order.
   */
  const patchBook = (id: string, fn: (book: Book) => Book): void => {
    let saved: Book | null = null
    set({
      books: get().books.map((b) => {
        if (b.id !== id) return b
        const next = fn(b)
        saved = { ...next, pages: groupPages(next.chapters, next.pages), updatedAt: Date.now() }
        return saved
      }),
    })
    if (saved) scheduleSave(saved, set)
  }

  return {
    books: [],
    loading: true,
    loadError: null,
    openBookId: null,
    openChapterId: null,
    openProsePageId: null,
    openPageId: null,
    selectedPanelId: null,
    selectedBalloonId: null,
    saveState: 'idle',

    load: async () => {
      try {
        const books = (await db.loadAllBooks()).map(normalizeBook)
        set({ books, loading: false, loadError: null })
      } catch {
        set({
          loading: false,
          loadError: 'Could not open local storage. Private browsing can block it — your work will not be saved.',
        })
      }
    },

    openBook: (id) => {
      const book = get().books.find((b) => b.id === id)
      set({
        openBookId: id,
        openChapterId: book?.chapters[0]?.id ?? null,
        openProsePageId: book?.chapters[0]?.pages[0]?.id ?? null,
        openPageId: book?.pages[0]?.id ?? null,
        selectedPanelId: null,
        selectedBalloonId: null,
      })
    },
    closeBook: () => set({
      openBookId: null, openChapterId: null, openProsePageId: null, openPageId: null,
      selectedPanelId: null, selectedBalloonId: null,
    }),
    selectChapter: (id) => {
      const book = get().books.find((b) => b.id === get().openBookId)
      const chapter = book?.chapters.find((c) => c.id === id)
      // Opening a chapter always lands on its first page, never on a page id
      // left over from the chapter before.
      set({ openChapterId: id, openProsePageId: chapter?.pages[0]?.id ?? null })
    },
    selectProsePage: (id) => set({ openProsePageId: id }),
    selectPage: (id) => set({ openPageId: id, selectedPanelId: null, selectedBalloonId: null }),
    selectPanel: (id) => set({ selectedPanelId: id, selectedBalloonId: null }),
    selectBalloon: (id) => set({ selectedBalloonId: id }),

    addBook: async (title, author, kind = 'prose') => {
      const book = createBook(title?.trim() || 'Untitled book', author?.trim() ?? '', kind)
      if (kind === 'graphic') book.pages = [createPage('four-grid', 'Page 1', null)]
      set({ books: [book, ...get().books] })
      await db.saveBook(book).catch(() => set({ saveState: 'error' }))
      return book.id
    },

    copyBook: async (id) => {
      const source = get().books.find((b) => b.id === id)
      if (!source) return
      const copy = duplicateBook(source)
      if (source.pages.length > 0) {
        const remap = await duplicateAssets(source.id, copy.id).catch(() => new Map<string, string>())
        copy.pages = remapAssets(copy.pages, remap)
      }
      set({ books: [copy, ...get().books] })
      await db.saveBook(copy).catch(() => set({ saveState: 'error' }))
    },

    removeBook: async (id) => {
      const timer = timers.get(id)
      if (timer) { clearTimeout(timer); timers.delete(id) }
      set({
        books: get().books.filter((b) => b.id !== id),
        openBookId: get().openBookId === id ? null : get().openBookId,
      })
      await db.deleteBook(id).catch(() => set({ saveState: 'error' }))
    },

    importBook: async (book) => {
      // Always re-key an imported book so importing the same file twice keeps
      // both copies instead of overwriting the first.
      const chapterIds = new Map(book.chapters.map((c) => [c.id, newId()]))
      const fresh: Book = normalizeBook({
        ...book,
        id: newId(),
        chapters: book.chapters.map((c) => ({
          ...c,
          id: chapterIds.get(c.id)!,
          pages: (c.pages ?? []).map((page) => ({ ...page, id: newId() })),
        })),
        pages: book.pages.map((page) => ({
          ...page,
          id: newId(),
          chapterId: page.chapterId ? chapterIds.get(page.chapterId) ?? null : null,
        })),
        updatedAt: Date.now(),
      })
      set({ books: [fresh, ...get().books] })
      await db.saveBook(fresh).catch(() => set({ saveState: 'error' }))
      return fresh.id
    },

    updateBook: (id, patch) => patchBook(id, (b) => ({ ...b, ...patch })),
    updateCover: (id, patch) => patchBook(id, (b) => ({ ...b, cover: { ...b.cover, ...patch } })),

    addChapter: (bookId, kind = 'chapter') => {
      const chapter = createChapter(kind, kind === 'front' ? 'Preface' : kind === 'back' ? 'Appendix' : 'New chapter')
      patchBook(bookId, (b) => {
        // Front matter belongs before the body; everything else appends.
        if (kind !== 'front') return { ...b, chapters: [...b.chapters, chapter] }
        const firstBody = b.chapters.findIndex((c) => c.kind !== 'front')
        const at = firstBody === -1 ? b.chapters.length : firstBody
        return { ...b, chapters: [...b.chapters.slice(0, at), chapter, ...b.chapters.slice(at)] }
      })
      set({ openChapterId: chapter.id, openProsePageId: chapter.pages[0].id })
    },

    updateChapter: (bookId, chapterId, patch) =>
      patchBook(bookId, (b) => ({
        ...b,
        chapters: b.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch, updatedAt: Date.now() } : c)),
      })),

    removeChapter: (bookId, chapterId) => {
      const book = get().books.find((b) => b.id === bookId)
      if (!book) return
      const index = book.chapters.findIndex((c) => c.id === chapterId)
      patchBook(bookId, (b) => ({ ...b, chapters: b.chapters.filter((c) => c.id !== chapterId) }))
      if (get().openChapterId === chapterId) {
        const remaining = book.chapters.filter((c) => c.id !== chapterId)
        const next = remaining[Math.min(index, remaining.length - 1)]
        set({ openChapterId: next?.id ?? null, openProsePageId: next?.pages[0]?.id ?? null })
      }
    },

    moveChapter: (bookId, from, to) =>
      patchBook(bookId, (b) => ({ ...b, chapters: move(b.chapters, from, to) })),

    /**
     * A long book is written a chapter at a time and saved as it goes, so
     * stopping halfway — or losing the connection — leaves the chapters
     * already written in the library rather than nothing at all.
     */
    addStoryChapter: (bookId, chapter, pages) =>
      patchBook(bookId, (b) => ({
        ...b,
        chapters: [...b.chapters, chapter],
        pages: [...b.pages, ...pages],
      })),

    // ── Pages inside a chapter ─────────────────────────────────────────────
    addProsePage: (bookId, chapterId) => {
      const page = createProsePage()
      patchBook(bookId, (b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id === chapterId ? { ...c, pages: [...c.pages, page], updatedAt: Date.now() } : c),
      }))
      set({ openChapterId: chapterId, openProsePageId: page.id })
    },

    updateProsePage: (bookId, chapterId, pageId, content) =>
      patchBook(bookId, (b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId ? c : {
            ...c,
            updatedAt: Date.now(),
            pages: c.pages.map((page) => (page.id === pageId ? { ...page, content } : page)),
          }),
      })),

    removeProsePage: (bookId, chapterId, pageId) => {
      const chapter = get().books.find((b) => b.id === bookId)?.chapters.find((c) => c.id === chapterId)
      // A chapter always keeps at least one page; emptying the last one is the
      // only sensible reading of "delete" when it is the only page left.
      if (!chapter) return
      const index = chapter.pages.findIndex((page) => page.id === pageId)
      if (index === -1) return
      const last = chapter.pages.length === 1
      const replacement = last ? createProsePage() : null
      patchBook(bookId, (b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id !== chapterId ? c : {
            ...c,
            updatedAt: Date.now(),
            pages: replacement ? [replacement] : c.pages.filter((page) => page.id !== pageId),
          }),
      }))
      if (get().openProsePageId === pageId) {
        const next = replacement
          ?? chapter.pages.filter((page) => page.id !== pageId)[Math.min(index, chapter.pages.length - 2)]
        set({ openProsePageId: next?.id ?? null })
      }
    },

    moveProsePage: (bookId, chapterId, from, to) =>
      patchBook(bookId, (b) => ({
        ...b,
        chapters: b.chapters.map((c) =>
          c.id === chapterId ? { ...c, pages: move(c.pages, from, to), updatedAt: Date.now() } : c),
      })),

    // ── Graphic novel pages ────────────────────────────────────────────────
    addPage: (bookId, layout = 'four-grid', chapterId = null) => {
      const book = get().books.find((b) => b.id === bookId)
      const filed = chapterId && book?.chapters.some((c) => c.id === chapterId) ? chapterId : null
      const page = createPage(layout, `Page ${(book?.pages.length ?? 0) + 1}`, filed)
      // Appending is enough: re-grouping drops the page at the end of its own
      // chapter's run rather than at the end of the book.
      patchBook(bookId, (b) => ({ ...b, pages: [...b.pages, page] }))
      set({ openPageId: page.id, selectedPanelId: null, selectedBalloonId: null })
    },

    updatePage: (bookId, pageId, patch) =>
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) => (p.id === pageId ? { ...p, ...patch } : p)),
      })),

    setPageLayout: (bookId, pageId, layout) => {
      const book = get().books.find((b) => b.id === bookId)
      const page = book?.pages.find((p) => p.id === pageId)
      if (!page) return
      const next = applyLayout(page, layout)
      // Panels dropped by a smaller layout take their artwork with them.
      const dropped = page.panels
        .slice(next.panels.length)
        .map((panel) => panel.assetId)
        .filter((id): id is string => !!id)
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) => (p.id === pageId ? next : p)),
      }))
      const stillOpen = get().books.find((b) => b.id === bookId)?.pages ?? []
      for (const id of orphanedAssets(stillOpen, dropped)) void removeAsset(id)
      if (!next.panels.some((panel) => panel.id === get().selectedPanelId)) {
        set({ selectedPanelId: null, selectedBalloonId: null })
      }
    },

    removePage: (bookId, pageId) => {
      const book = get().books.find((b) => b.id === bookId)
      if (!book) return
      const page = book.pages.find((p) => p.id === pageId)
      const index = book.pages.findIndex((p) => p.id === pageId)
      const dropped = (page?.panels ?? [])
        .map((panel) => panel.assetId)
        .filter((id): id is string => !!id)

      patchBook(bookId, (b) => ({ ...b, pages: b.pages.filter((p) => p.id !== pageId) }))

      const remaining = get().books.find((b) => b.id === bookId)?.pages ?? []
      for (const id of orphanedAssets(remaining, dropped)) void removeAsset(id)
      if (get().openPageId === pageId) {
        const next = remaining[Math.min(index, remaining.length - 1)]
        set({ openPageId: next?.id ?? null, selectedPanelId: null, selectedBalloonId: null })
      }
    },

    movePage: (bookId, pageId, delta) =>
      patchBook(bookId, (b) => ({ ...b, pages: stepPage(b.chapters, b.pages, pageId, delta) })),

    setPageChapter: (bookId, pageId, chapterId) =>
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) => (p.id === pageId ? { ...p, chapterId } : p)),
      })),

    updatePanel: (bookId, pageId, panelId, patch) =>
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            panels: p.panels.map((panel) => (panel.id === panelId ? { ...panel, ...patch } : panel)),
          }),
      })),

    /**
     * Swapping artwork must collect the image being replaced, otherwise every
     * redraw leaves another orphaned asset behind in storage.
     */
    setPanelArt: (bookId, pageId, panelId, assetId) => {
      const book = get().books.find((b) => b.id === bookId)
      const previous = book?.pages.find((p) => p.id === pageId)?.panels.find((panel) => panel.id === panelId)?.assetId
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            panels: p.panels.map((panel) =>
              panel.id === panelId ? { ...panel, assetId, zoom: 1, offsetX: 0, offsetY: 0 } : panel),
          }),
      }))
      if (previous && previous !== assetId) {
        const pages = get().books.find((b) => b.id === bookId)?.pages ?? []
        for (const id of orphanedAssets(pages, [previous])) void removeAsset(id)
      }
    },

    clearPanelArt: (bookId, pageId, panelId) => {
      const book = get().books.find((b) => b.id === bookId)
      const previous = book?.pages.find((p) => p.id === pageId)?.panels.find((panel) => panel.id === panelId)?.assetId
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            panels: p.panels.map((panel) =>
              panel.id === panelId ? { ...panel, assetId: null, zoom: 1, offsetX: 0, offsetY: 0 } : panel),
          }),
      }))
      if (previous) {
        const pages = get().books.find((b) => b.id === bookId)?.pages ?? []
        for (const id of orphanedAssets(pages, [previous])) void removeAsset(id)
      }
    },

    addBalloon: (bookId, pageId, panelId, kind) => {
      const balloon = createBalloon(kind)
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            panels: p.panels.map((panel) =>
              panel.id === panelId ? { ...panel, balloons: [...panel.balloons, balloon] } : panel),
          }),
      }))
      set({ selectedPanelId: panelId, selectedBalloonId: balloon.id })
    },

    setPanelBalloons: (bookId, pageId, panelId, balloons, letterBand) =>
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            panels: p.panels.map((panel) =>
              panel.id !== panelId ? panel : {
                ...panel,
                balloons,
                ...(letterBand === undefined ? {} : { letterBand }),
              }),
          }),
      })),

    updateBalloon: (bookId, pageId, panelId, balloonId, patch) =>
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            panels: p.panels.map((panel) =>
              panel.id !== panelId ? panel : {
                ...panel,
                balloons: panel.balloons.map((balloon) =>
                  balloon.id === balloonId ? { ...balloon, ...patch } : balloon),
              }),
          }),
      })),

    removeBalloon: (bookId, pageId, panelId, balloonId) => {
      patchBook(bookId, (b) => ({
        ...b,
        pages: b.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            panels: p.panels.map((panel) =>
              panel.id !== panelId ? panel : {
                ...panel,
                balloons: panel.balloons.filter((balloon) => balloon.id !== balloonId),
              }),
          }),
      }))
      if (get().selectedBalloonId === balloonId) set({ selectedBalloonId: null })
    },
  }
})

/** The book currently open, if any. */
export function useOpenBook(): Book | null {
  return useStore((s) => s.books.find((b) => b.id === s.openBookId) ?? null)
}

export function useOpenPage(): Page | null {
  return useStore((s) => {
    const book = s.books.find((b) => b.id === s.openBookId)
    return book?.pages.find((p) => p.id === s.openPageId) ?? null
  })
}

export function useOpenChapter(): Chapter | null {
  return useStore((s) => {
    const book = s.books.find((b) => b.id === s.openBookId)
    return book?.chapters.find((c) => c.id === s.openChapterId) ?? null
  })
}

/** The page of the open chapter the editor is on — its first page by default. */
export function useOpenProsePage(): ProsePage | null {
  return useStore((s) => {
    const book = s.books.find((b) => b.id === s.openBookId)
    const chapter = book?.chapters.find((c) => c.id === s.openChapterId)
    if (!chapter) return null
    return chapter.pages.find((page) => page.id === s.openProsePageId) ?? chapter.pages[0] ?? null
  })
}
