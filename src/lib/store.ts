import { create } from 'zustand'
import type { Book, Chapter, ChapterKind, Cover } from '@/types'
import { createBook, createChapter, duplicateBook, move, newId } from '@/lib/book'
import * as db from '@/lib/db'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface State {
  books: Book[]
  loading: boolean
  loadError: string | null
  /** null = library view. */
  openBookId: string | null
  openChapterId: string | null
  saveState: SaveState

  load: () => Promise<void>
  openBook: (id: string) => void
  closeBook: () => void
  selectChapter: (id: string) => void

  addBook: (title?: string, author?: string) => Promise<string>
  copyBook: (id: string) => Promise<void>
  removeBook: (id: string) => Promise<void>
  importBook: (book: Book) => Promise<void>

  updateBook: (id: string, patch: Partial<Omit<Book, 'id' | 'chapters'>>) => void
  updateCover: (id: string, patch: Partial<Cover>) => void

  addChapter: (bookId: string, kind?: ChapterKind) => void
  updateChapter: (bookId: string, chapterId: string, patch: Partial<Omit<Chapter, 'id'>>) => void
  removeChapter: (bookId: string, chapterId: string) => void
  moveChapter: (bookId: string, from: number, to: number) => void
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
  /** Apply a change to one book, stamp updatedAt, and queue the save. */
  const patchBook = (id: string, fn: (book: Book) => Book): void => {
    let saved: Book | null = null
    set({
      books: get().books.map((b) => {
        if (b.id !== id) return b
        saved = { ...fn(b), updatedAt: Date.now() }
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
    saveState: 'idle',

    load: async () => {
      try {
        const books = await db.loadAllBooks()
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
      set({ openBookId: id, openChapterId: book?.chapters[0]?.id ?? null })
    },
    closeBook: () => set({ openBookId: null, openChapterId: null }),
    selectChapter: (id) => set({ openChapterId: id }),

    addBook: async (title, author) => {
      const book = createBook(title?.trim() || 'Untitled book', author?.trim() ?? '')
      set({ books: [book, ...get().books] })
      await db.saveBook(book).catch(() => set({ saveState: 'error' }))
      return book.id
    },

    copyBook: async (id) => {
      const source = get().books.find((b) => b.id === id)
      if (!source) return
      const copy = duplicateBook(source)
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
      const fresh: Book = {
        ...book,
        id: newId(),
        chapters: book.chapters.map((c) => ({ ...c, id: newId() })),
        updatedAt: Date.now(),
      }
      set({ books: [fresh, ...get().books] })
      await db.saveBook(fresh).catch(() => set({ saveState: 'error' }))
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
      set({ openChapterId: chapter.id })
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
        set({ openChapterId: next?.id ?? null })
      }
    },

    moveChapter: (bookId, from, to) =>
      patchBook(bookId, (b) => ({ ...b, chapters: move(b.chapters, from, to) })),
  }
})

/** The book currently open, if any. */
export function useOpenBook(): Book | null {
  return useStore((s) => s.books.find((b) => b.id === s.openBookId) ?? null)
}

export function useOpenChapter(): Chapter | null {
  return useStore((s) => {
    const book = s.books.find((b) => b.id === s.openBookId)
    return book?.chapters.find((c) => c.id === s.openChapterId) ?? null
  })
}
