import { useMemo, useRef, useState } from 'react'
import { Icons } from '@/components/Icons'
import { BookCover } from '@/components/BookCover'
import { ConfirmDialog, EmptyState, Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import { bookStats, formatCount, readingSummary } from '@/lib/stats'
import { bookFromJson } from '@/lib/export'
import type { Book } from '@/types'

function relativeDate(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function NewBookDialog({ onClose }: { onClose: () => void }) {
  const addBook = useStore((s) => s.addBook)
  const openBook = useStore((s) => s.openBook)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')

  const create = async (): Promise<void> => {
    const id = await addBook(title, author)
    openBook(id)
    onClose()
  }

  return (
    <Modal
      title="Start a new book"
      subtitle="You can change any of this later."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={create}>Create book</button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); void create() }}
      >
        <label className="block">
          <span className="label">Title</span>
          <input autoFocus className="field" value={title} placeholder="Untitled book" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Author</span>
          <input className="field" value={author} placeholder="Your name" onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

function BookCard({ book, onDelete }: { book: Book; onDelete: () => void }) {
  const openBook = useStore((s) => s.openBook)
  const copyBook = useStore((s) => s.copyBook)
  const stats = useMemo(() => bookStats(book), [book])

  return (
    <div className="group relative">
      <button
        className="block w-full text-left focus:outline-none"
        onClick={() => openBook(book.id)}
        aria-label={`Open ${book.title}`}
      >
        <BookCover
          book={book}
          compact
          className="transition-transform duration-200 group-hover:-translate-y-1 group-focus-visible:-translate-y-1"
        />
        <div className="mt-3">
          <h3 className="truncate text-sm font-semibold text-ink">{book.title || 'Untitled book'}</h3>
          <p className="mt-0.5 text-xs text-ink-faint">
            {formatCount(stats.words)} words · {stats.chapters} {stats.chapters === 1 ? 'chapter' : 'chapters'}
          </p>
          <p className="text-xs text-ink-faint">Edited {relativeDate(book.updatedAt)}</p>
        </div>
      </button>

      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          className="rounded-md bg-paper-raised/95 p-1.5 text-ink-soft shadow-sm hover:text-ink"
          title="Duplicate"
          aria-label={`Duplicate ${book.title}`}
          onClick={() => void copyBook(book.id)}
        >
          <Icons.Copy className="h-3.5 w-3.5" />
        </button>
        <button
          className="rounded-md bg-paper-raised/95 p-1.5 text-red-700 shadow-sm hover:bg-red-50"
          title="Delete"
          aria-label={`Delete ${book.title}`}
          onClick={onDelete}
        >
          <Icons.Trash className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function Library() {
  const books = useStore((s) => s.books)
  const loading = useStore((s) => s.loading)
  const loadError = useStore((s) => s.loadError)
  const removeBook = useStore((s) => s.removeBook)
  const importBook = useStore((s) => s.importBook)

  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return books
    return books.filter((b) =>
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q) ||
      b.subtitle.toLowerCase().includes(q))
  }, [books, query])

  const totalWords = useMemo(() => books.reduce((sum, b) => sum + bookStats(b).words, 0), [books])

  const onImport = async (file: File): Promise<void> => {
    try {
      await importBook(bookFromJson(await file.text()))
      setImportError(null)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'That file could not be imported.')
    }
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">Your books</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {books.length === 0
              ? 'Everything you write is saved in this browser.'
              : `${books.length} ${books.length === 1 ? 'book' : 'books'} · ${formatCount(totalWords)} words · ${readingSummary(Math.round(totalWords / 230))}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              className="field w-56 pl-8"
              placeholder="Search books"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onImport(file)
              e.target.value = ''
            }}
          />
          <button className="btn btn-outline" onClick={() => fileInput.current?.click()}>
            <Icons.Upload /> Import
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icons.Plus /> New book
          </button>
        </div>
      </header>

      {loadError && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Icons.Alert className="mt-0.5 h-4 w-4 shrink-0" /> {loadError}
        </p>
      )}
      {importError && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Icons.Alert className="mt-0.5 h-4 w-4 shrink-0" /> {importError}
        </p>
      )}

      {loading ? (
        <p className="py-20 text-center text-sm text-ink-faint">Opening your library…</p>
      ) : books.length === 0 ? (
        <EmptyState
          icon={<Icons.Book className="h-5 w-5" />}
          title="No books yet"
          body="Start one and write the first chapter. You can export it as a PDF, Word file, or EPUB whenever you're ready."
          action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Icons.Plus /> New book</button>}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Icons.Search className="h-5 w-5" />}
          title="Nothing matches that"
          body={`No book matches “${query}”.`}
          action={<button className="btn btn-outline" onClick={() => setQuery('')}>Clear search</button>}
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shown.map((book) => (
            <BookCard key={book.id} book={book} onDelete={() => setPendingDelete(book)} />
          ))}
        </div>
      )}

      {creating && <NewBookDialog onClose={() => setCreating(false)} />}
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.title || 'Untitled book'}”?`}
          body="This removes the book and all of its chapters from this browser. It cannot be undone — export a backup first if you want to keep it."
          confirmLabel="Delete book"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { void removeBook(pendingDelete.id); setPendingDelete(null) }}
        />
      )}
    </div>
  )
}
