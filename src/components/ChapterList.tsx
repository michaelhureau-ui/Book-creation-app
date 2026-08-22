import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { ConfirmDialog } from '@/components/ui'
import { useStore } from '@/lib/store'
import { chapterNumbers } from '@/lib/book'
import { chapterWords, formatCount } from '@/lib/stats'
import type { Book, Chapter, ChapterKind } from '@/types'

const KIND_LABEL: Record<ChapterKind, string> = {
  front: 'Front matter',
  chapter: 'Chapters',
  back: 'Back matter',
}

function ChapterRow({
  book, chapter, index, number, selected,
}: {
  book: Book
  chapter: Chapter
  index: number
  number: number | undefined
  selected: boolean
}) {
  const selectChapter = useStore((s) => s.selectChapter)
  const updateChapter = useStore((s) => s.updateChapter)
  const moveChapter = useStore((s) => s.moveChapter)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(chapter.title)
  const [pendingDelete, setPendingDelete] = useState(false)
  const removeChapter = useStore((s) => s.removeChapter)
  const words = useMemo(() => chapterWords(chapter), [chapter])

  const commit = (): void => {
    updateChapter(book.id, chapter.id, { title: draft.trim() || 'Untitled' })
    setRenaming(false)
  }

  return (
    <>
      <li
        className={clsx(
          'group relative rounded-lg border transition-colors',
          selected ? 'border-accent/35 bg-accent-soft/60' : 'border-transparent hover:bg-paper-sunk',
        )}
      >
        {renaming ? (
          <div className="p-2">
            <input
              autoFocus
              className="field py-1 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') { setDraft(chapter.title); setRenaming(false) }
              }}
            />
          </div>
        ) : (
          <button
            className="block w-full px-3 py-2 pr-8 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            onClick={() => selectChapter(chapter.id)}
            onDoubleClick={() => { setDraft(chapter.title); setRenaming(true) }}
          >
            <span className={clsx('block truncate text-sm', selected ? 'font-semibold text-ink' : 'text-ink-soft')}>
              {number ? `${number}. ` : ''}{chapter.title || 'Untitled'}
            </span>
            <span className="mt-0.5 block text-xs text-ink-faint">
              {words === 0 ? 'Empty' : `${formatCount(words)} words`}
            </span>
          </button>
        )}

        {!renaming && (
          <div className="absolute right-1 top-1 flex flex-col opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
              title="Move up"
              aria-label={`Move ${chapter.title} up`}
              disabled={index === 0}
              onClick={() => moveChapter(book.id, index, index - 1)}
            >
              <Icons.Up className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
              title="Move down"
              aria-label={`Move ${chapter.title} down`}
              disabled={index === book.chapters.length - 1}
              onClick={() => moveChapter(book.id, index, index + 1)}
            >
              <Icons.Down className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {!renaming && (
          <div className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              className="rounded p-0.5 text-ink-faint hover:text-ink"
              title="Rename"
              aria-label={`Rename ${chapter.title}`}
              onClick={() => { setDraft(chapter.title); setRenaming(true) }}
            >
              <Icons.Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded p-0.5 text-ink-faint hover:text-red-700"
              title="Delete chapter"
              aria-label={`Delete ${chapter.title}`}
              onClick={() => setPendingDelete(true)}
            >
              <Icons.Trash className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </li>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${chapter.title || 'Untitled'}”?`}
          body={words > 0
            ? `This chapter has ${formatCount(words)} words. Deleting it cannot be undone.`
            : 'This chapter is empty. Deleting it cannot be undone.'}
          confirmLabel="Delete chapter"
          onCancel={() => setPendingDelete(false)}
          onConfirm={() => { removeChapter(book.id, chapter.id); setPendingDelete(false) }}
        />
      )}
    </>
  )
}

export function ChapterList({ book }: { book: Book }) {
  const openChapterId = useStore((s) => s.openChapterId)
  const addChapter = useStore((s) => s.addChapter)
  const numbers = useMemo(() => chapterNumbers(book.chapters), [book.chapters])

  // Chapters keep their stored order; the headings just mark where each run of
  // front/body/back matter begins.
  const rows = book.chapters.map((chapter, index) => ({ chapter, index }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Contents</h2>
        <button
          className="btn btn-ghost px-1.5 py-1"
          title="Add chapter"
          aria-label="Add chapter"
          onClick={() => addChapter(book.id, 'chapter')}
        >
          <Icons.Plus className="h-4 w-4" />
        </button>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 scrollbar-slim">
        {rows.map(({ chapter, index }, i) => {
          const previous = rows[i - 1]?.chapter
          const showHeading = !previous || previous.kind !== chapter.kind
          return (
            <div key={chapter.id}>
              {showHeading && (
                <p className="px-2 pb-1 pt-3 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-faint/80">
                  {KIND_LABEL[chapter.kind]}
                </p>
              )}
              <ChapterRow
                book={book}
                chapter={chapter}
                index={index}
                number={numbers.get(chapter.id)}
                selected={chapter.id === openChapterId}
              />
            </div>
          )
        })}
        {book.chapters.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">No chapters yet.</p>
        )}
      </ul>

      <div className="grid grid-cols-3 gap-0.5 border-t border-rule p-1.5">
        {([['front', 'Preface'], ['chapter', 'Chapter'], ['back', 'Appendix']] as const).map(([kind, label]) => (
          <button
            key={kind}
            className="btn btn-ghost whitespace-nowrap px-0.5 py-1 text-[0.7rem]"
            onClick={() => addChapter(book.id, kind)}
          >
            + {label}
          </button>
        ))}
      </div>
    </div>
  )
}
