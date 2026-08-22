import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { Editor } from '@/components/Editor'
import { ChapterList } from '@/components/ChapterList'
import { DetailsPanel } from '@/components/DetailsPanel'
import { Preview } from '@/components/Preview'
import { ExportDialog } from '@/components/ExportDialog'
import { GraphicWorkspace } from '@/components/graphic/GraphicWorkspace'
import { Drawer, EmptyState } from '@/components/ui'
import { useMediaQuery } from '@/lib/useNarrow'
import type { TrimId } from '@/lib/graphic/render'
import { useOpenBook, useOpenChapter, useStore } from '@/lib/store'
import { chapterNumbers } from '@/lib/book'
import { bookStats, chapterWords, formatCount } from '@/lib/stats'

function SaveIndicator() {
  const state = useStore((s) => s.saveState)
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700">
        <Icons.Alert className="h-3.5 w-3.5" /> Not saved
      </span>
    )
  }
  if (state === 'saving') return <span className="text-xs text-ink-faint">Saving…</span>
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-xs text-ink-faint">
        <Icons.Check className="h-3.5 w-3.5" /> Saved
      </span>
    )
  }
  return null
}

export function Workspace() {
  const book = useOpenBook()
  const chapter = useOpenChapter()
  const closeBook = useStore((s) => s.closeBook)
  const updateChapter = useStore((s) => s.updateChapter)
  const addChapter = useStore((s) => s.addChapter)

  const [panel, setPanel] = useState<'details' | 'preview' | 'export' | null>(null)
  // The comic page size is a view/export setting rather than part of the book,
  // so it lives here and is handed to both the editor and the export dialog.
  const [trim, setTrim] = useState<TrimId>('comic')
  // The chapter list is docked from 640px up; below that it moves to a drawer.
  // It is rendered in one place or the other, never both.
  const chaptersDocked = useMediaQuery('(min-width: 640px)')
  const [chaptersOpen, setChaptersOpen] = useState(false)

  useEffect(() => { if (chaptersDocked) setChaptersOpen(false) }, [chaptersDocked])

  // ⌘/Ctrl+P previews, ⌘/Ctrl+E exports — both common enough while drafting to
  // be worth a shortcut, and both otherwise buried behind the header buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'p') { e.preventDefault(); setPanel('preview') }
      if (key === 'e') { e.preventDefault(); setPanel('export') }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const numbers = useMemo(() => chapterNumbers(book?.chapters ?? []), [book?.chapters])
  const stats = useMemo(() => (book ? bookStats(book) : null), [book])
  const words = useMemo(() => (chapter ? chapterWords(chapter) : 0), [chapter])

  if (!book) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-rule bg-paper-raised px-4 py-2.5">
        <button className="btn btn-ghost px-2" onClick={closeBook} title="Back to library">
          <Icons.Back /> <span className="hidden sm:inline">Library</span>
        </button>

        {book.kind === 'prose' && !chaptersDocked && (
          <button
            className="btn btn-outline shrink-0 px-2 py-1 text-xs"
            onClick={() => setChaptersOpen(true)}
          >
            Chapters
          </button>
        )}

        <div className="min-w-0 flex-1">
          <button
            className="block max-w-full truncate text-left font-serif text-base font-semibold text-ink hover:text-accent-deep"
            onClick={() => setPanel('details')}
            title="Edit book details"
          >
            {book.title || 'Untitled book'}
          </button>
          <p className="truncate text-xs text-ink-faint">
            {book.author.trim() || 'No author set'}
            {stats && (book.kind === 'graphic'
              ? ` · ${stats.pages} ${stats.pages === 1 ? 'page' : 'pages'} · ${stats.artworkPlaced}/${stats.panels} panels drawn`
              : ` · ${formatCount(stats.words)} words`)}
          </p>
        </div>

        <SaveIndicator />

        <div className="flex items-center gap-1">
          <button className="btn btn-ghost px-2" onClick={() => setPanel('details')} title="Book details">
            <Icons.Pencil /> <span className="hidden md:inline">Details</span>
          </button>
          <button className="btn btn-outline" onClick={() => setPanel('preview')} title="Preview (⌘P)">
            <Icons.Eye /> <span className="hidden md:inline">Preview</span>
          </button>
          <button className="btn btn-primary" onClick={() => setPanel('export')} title="Export (⌘E)">
            <Icons.Download /> <span className="hidden md:inline">Export</span>
          </button>
        </div>
      </header>

      {book.kind === 'graphic' ? (
        <GraphicWorkspace book={book} trim={trim} onTrimChange={setTrim} />
      ) : (
      <div className="flex min-h-0 flex-1">
        {chaptersDocked && (
          <aside className="w-60 shrink-0 border-r border-rule bg-paper-raised/60">
            <ChapterList book={book} />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-paper-raised">
          {chapter ? (
            <>
              <div className="flex shrink-0 items-baseline justify-between gap-3 border-b border-rule px-6 py-3">
                <input
                  className="min-w-0 flex-1 bg-transparent font-serif text-xl font-semibold text-ink placeholder:text-ink-faint focus:outline-none"
                  value={chapter.title}
                  placeholder="Chapter title"
                  aria-label="Chapter title"
                  onChange={(e) => updateChapter(book.id, chapter.id, { title: e.target.value })}
                />
                <span className={clsx('shrink-0 text-xs text-ink-faint')}>
                  {numbers.get(chapter.id) ? `Chapter ${numbers.get(chapter.id)} · ` : ''}
                  {formatCount(words)} words
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <Editor
                  key={chapter.id}
                  chapter={chapter}
                  onChange={(html) => updateChapter(book.id, chapter.id, { content: html })}
                />
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Icons.Book className="h-5 w-5" />}
              title="No chapter selected"
              body="Add a chapter to start writing."
              action={
                <button className="btn btn-primary" onClick={() => addChapter(book.id, 'chapter')}>
                  <Icons.Plus /> Add chapter
                </button>
              }
            />
          )}
        </main>
      </div>
      )}

      {chaptersOpen && !chaptersDocked && (
        <Drawer title="Contents" side="left" onClose={() => setChaptersOpen(false)}>
          <ChapterList book={book} />
        </Drawer>
      )}

      {panel === 'details' && <DetailsPanel book={book} onClose={() => setPanel(null)} />}
      {panel === 'preview' && <Preview book={book} trim={trim} onClose={() => setPanel(null)} />}
      {panel === 'export' && <ExportDialog book={book} trim={trim} onClose={() => setPanel(null)} />}
    </div>
  )
}
