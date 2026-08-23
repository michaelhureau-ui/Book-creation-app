import { useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { ConfirmDialog } from '@/components/ui'
import { useStore } from '@/lib/store'
import { pageGroups } from '@/lib/book'
import { LAYOUTS, layoutOf } from '@/lib/graphic/layouts'
import type { Book, Chapter, Page } from '@/types'

/** A miniature of the layout, so pages are recognisable at a glance. */
function LayoutGlyph({ page, className }: { page: Page; className?: string }) {
  const frames = layoutOf(page.layout).frames
  return (
    <svg viewBox="0 0 40 60" className={className} aria-hidden="true">
      <rect x="0" y="0" width="40" height="60" rx="2" className="fill-paper-raised stroke-rule" strokeWidth="1" />
      {frames.map((f, i) => (
        <rect
          key={i}
          x={3 + f.x * 34}
          y={3 + f.y * 54}
          width={f.w * 34 - 1.5}
          height={f.h * 54 - 1.5}
          rx="1"
          className={page.panels[i]?.assetId ? 'fill-accent/60' : 'fill-paper-sunk'}
          stroke="currentColor"
          strokeWidth="0.8"
        />
      ))}
    </svg>
  )
}

/** The eight layouts, offered when a page is added. */
function LayoutPicker({ onPick, onCancel }: {
  onPick: (layout: Page['layout']) => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-1">
      <p className="px-1 pb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-faint">
        Choose a layout
      </p>
      <div className="grid grid-cols-4 gap-1">
        {LAYOUTS.map((layout) => (
          <button
            key={layout.id}
            className="rounded-md border border-rule p-1 hover:border-accent hover:bg-accent-soft/40"
            title={layout.label}
            aria-label={`Add a ${layout.label} page`}
            onClick={() => onPick(layout.id)}
          >
            <LayoutGlyph
              page={{ id: '', title: '', layout: layout.id, chapterId: null, panels: [] }}
              className="h-9 w-full text-rule-strong"
            />
          </button>
        ))}
      </div>
      <button className="btn btn-ghost w-full py-1 text-xs" onClick={onCancel}>Cancel</button>
    </div>
  )
}

function ChapterHeading({ book, chapter, index, onAddPage, pageCount }: {
  book: Book
  chapter: Chapter
  index: number
  pageCount: number
  onAddPage: () => void
}) {
  const updateChapter = useStore((s) => s.updateChapter)
  const removeChapter = useStore((s) => s.removeChapter)
  const moveChapter = useStore((s) => s.moveChapter)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(chapter.title)
  const [pendingDelete, setPendingDelete] = useState(false)

  const commit = (): void => {
    updateChapter(book.id, chapter.id, { title: draft.trim() || 'Untitled chapter' })
    setRenaming(false)
  }

  if (renaming) {
    return (
      <div className="px-1 pb-1 pt-3">
        <input
          autoFocus
          className="field py-1 text-xs"
          value={draft}
          aria-label="Chapter title"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(chapter.title); setRenaming(false) }
          }}
        />
      </div>
    )
  }

  return (
    <>
      <div className="group/chapter flex items-center gap-1 px-1 pb-1 pt-3">
        <button
          className="min-w-0 flex-1 truncate text-left text-[0.65rem] font-semibold uppercase tracking-wider text-ink-faint/90 hover:text-ink"
          title="Rename this chapter"
          onClick={() => { setDraft(chapter.title); setRenaming(true) }}
        >
          {index + 1}. {chapter.title || 'Untitled chapter'}
          <span className="ml-1 font-normal normal-case tracking-normal">
            ({pageCount})
          </span>
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/chapter:opacity-100">
          <button
            className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
            title="Move chapter up"
            aria-label={`Move ${chapter.title || 'chapter'} up`}
            disabled={index === 0}
            onClick={() => moveChapter(book.id, index, index - 1)}
          >
            <Icons.Up className="h-3 w-3" />
          </button>
          <button
            className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
            title="Move chapter down"
            aria-label={`Move ${chapter.title || 'chapter'} down`}
            disabled={index === book.chapters.length - 1}
            onClick={() => moveChapter(book.id, index, index + 1)}
          >
            <Icons.Down className="h-3 w-3" />
          </button>
          <button
            className="rounded p-0.5 text-ink-faint hover:text-ink"
            title="Add a page to this chapter"
            aria-label={`Add a page to ${chapter.title || 'this chapter'}`}
            onClick={onAddPage}
          >
            <Icons.Plus className="h-3 w-3" />
          </button>
          <button
            className="rounded p-0.5 text-ink-faint hover:text-red-700"
            title="Delete chapter"
            aria-label={`Delete ${chapter.title || 'chapter'}`}
            onClick={() => setPendingDelete(true)}
          >
            <Icons.Trash className="h-3 w-3" />
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${chapter.title || 'Untitled chapter'}”?`}
          body={pageCount > 0
            ? `Its ${pageCount} ${pageCount === 1 ? 'page stays' : 'pages stay'} in the book, unfiled. Only the chapter heading is removed.`
            : 'This chapter has no pages in it yet.'}
          confirmLabel="Delete chapter"
          onCancel={() => setPendingDelete(false)}
          onConfirm={() => { removeChapter(book.id, chapter.id); setPendingDelete(false) }}
        />
      )}
    </>
  )
}

function PageRow({ book, page, number, canMoveUp, canMoveDown }: {
  book: Book
  page: Page
  number: number
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const openPageId = useStore((s) => s.openPageId)
  const selectPage = useStore((s) => s.selectPage)
  const movePage = useStore((s) => s.movePage)
  const removePage = useStore((s) => s.removePage)
  const [pendingDelete, setPendingDelete] = useState(false)
  const selected = page.id === openPageId
  const filled = page.panels.filter((p) => p.assetId).length

  return (
    <li
      className={clsx(
        'group relative rounded-lg border transition-colors',
        selected ? 'border-accent/35 bg-accent-soft/60' : 'border-transparent hover:bg-paper-sunk',
      )}
    >
      <button
        className="flex w-full items-center gap-3 px-2.5 py-2 text-left focus:outline-none"
        onClick={() => selectPage(page.id)}
      >
        <LayoutGlyph page={page} className="h-12 w-8 shrink-0 text-rule-strong" />
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate text-sm', selected ? 'font-semibold text-ink' : 'text-ink-soft')}>
            {number}. {page.title || 'Untitled page'}
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {filled}/{page.panels.length} drawn
          </span>
        </span>
      </button>

      <div className="absolute right-1 top-1 flex flex-col opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
          title="Move up"
          aria-label={`Move page ${number} up`}
          disabled={!canMoveUp}
          onClick={() => movePage(book.id, page.id, -1)}
        >
          <Icons.Up className="h-3.5 w-3.5" />
        </button>
        <button
          className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
          title="Move down"
          aria-label={`Move page ${number} down`}
          disabled={!canMoveDown}
          onClick={() => movePage(book.id, page.id, 1)}
        >
          <Icons.Down className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        className="absolute bottom-1 right-1 rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-red-700 focus:opacity-100 group-hover:opacity-100"
        title="Delete page"
        aria-label={`Delete page ${number}`}
        onClick={() => setPendingDelete(true)}
      >
        <Icons.Trash className="h-3.5 w-3.5" />
      </button>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${page.title || 'this page'}”?`}
          body="The page, its panels, and any artwork placed on it are removed. This cannot be undone."
          confirmLabel="Delete page"
          onCancel={() => setPendingDelete(false)}
          onConfirm={() => { removePage(book.id, page.id); setPendingDelete(false) }}
        />
      )}
    </li>
  )
}

export function PageList({ book }: { book: Book }) {
  const addPage = useStore((s) => s.addPage)
  const addChapter = useStore((s) => s.addChapter)
  const openPageId = useStore((s) => s.openPageId)
  // Which run the layout picker is adding to — a chapter id, or null for the
  // pages that sit outside every chapter. `false` means it is closed.
  const [adding, setAdding] = useState<string | null | false>(false)

  const groups = pageGroups(book)
  const hasUnfiled = book.pages.some((p) => !p.chapterId)
  // A page added from the footer joins whichever chapter is being worked on;
  // failing that it goes to the end of the book.
  const footerTarget = book.pages.find((p) => p.id === openPageId)?.chapterId
    ?? (hasUnfiled || book.chapters.length === 0 ? null : book.chapters[book.chapters.length - 1].id)
  // An empty book has no run to draw the picker under, so it falls to the foot.
  const pickerInline = adding !== false && groups.some((g) => (g.chapter?.id ?? null) === adding)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-1 px-4 pb-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Pages</h2>
        <div className="flex items-center gap-1">
          <span className="text-xs text-ink-faint">{book.pages.length}</span>
          <button
            className="btn btn-ghost whitespace-nowrap px-1.5 py-0.5 text-[0.7rem]"
            title="Group the pages into a new chapter"
            onClick={() => addChapter(book.id, 'chapter')}
          >
            <Icons.Plus className="h-3 w-3" /> Chapter
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-slim">
        {groups.map(({ chapter, pages }, groupIndex) => (
          <div key={chapter?.id ?? 'unfiled'}>
            {chapter ? (
              <ChapterHeading
                book={book}
                chapter={chapter}
                index={book.chapters.indexOf(chapter)}
                pageCount={pages.length}
                onAddPage={() => setAdding(chapter.id)}
              />
            ) : (
              // Only worth a heading once there is a chapter to contrast with.
              book.chapters.length > 0 && (
                <p className="px-1 pb-1 pt-3 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-faint/90">
                  Before the first chapter
                </p>
              )
            )}

            <ul className="space-y-1">
              {pages.map((page) => {
                const at = book.pages.indexOf(page)
                // A page at the end of the book can still step into the next
                // chapter heading, and out of the first one back into the loose
                // run, so the arrows follow the chapters rather than the index.
                const rank = chapter ? book.chapters.indexOf(chapter) : -1
                return (
                  <PageRow
                    key={page.id}
                    book={book}
                    page={page}
                    number={at + 1}
                    canMoveUp={at > 0 || rank > -1}
                    canMoveDown={at < book.pages.length - 1 || rank < book.chapters.length - 1}
                  />
                )
              })}
            </ul>

            {chapter && pages.length === 0 && (
              <button
                className="mt-1 w-full rounded-lg border border-dashed border-rule px-2 py-2 text-xs text-ink-faint hover:border-accent hover:text-ink"
                onClick={() => setAdding(chapter.id)}
              >
                <Icons.Plus className="mr-1 inline h-3 w-3" />
                First page of this chapter
              </button>
            )}

            {pickerInline && adding === (chapter?.id ?? null) && (
              <div className="mt-2 rounded-lg border border-rule bg-paper-sunk/60 p-1.5">
                <LayoutPicker
                  onPick={(layout) => { addPage(book.id, layout, chapter?.id ?? null); setAdding(false) }}
                  onCancel={() => setAdding(false)}
                />
              </div>
            )}
            {groupIndex === groups.length - 1 && <div className="h-2" />}
          </div>
        ))}

        {book.pages.length === 0 && book.chapters.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">No pages yet.</p>
        )}
      </div>

      <div className="border-t border-rule p-2">
        {adding === false ? (
          <button className="btn btn-outline w-full py-1.5 text-xs" onClick={() => setAdding(footerTarget)}>
            <Icons.Plus className="h-3.5 w-3.5" /> Add page
          </button>
        ) : pickerInline ? (
          <p className="px-1 text-center text-[0.7rem] text-ink-faint">Pick a layout above.</p>
        ) : (
          <LayoutPicker
            onPick={(layout) => { addPage(book.id, layout, adding); setAdding(false) }}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
    </div>
  )
}
