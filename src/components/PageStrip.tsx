import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { ConfirmDialog } from '@/components/ui'
import { useStore } from '@/lib/store'
import { parseBlocks, blocksText } from '@/lib/blocks'
import { countWords, formatCount } from '@/lib/stats'
import type { Book, Chapter } from '@/types'

/**
 * A chapter is written as a run of pages. The strip is how many there are, and
 * where the writer is in them — it stays out of the way at one page and turns
 * into a set of tabs as soon as there are more.
 */
export function PageStrip({ book, chapter, openPageId }: {
  book: Book
  chapter: Chapter
  openPageId: string | null
}) {
  const selectProsePage = useStore((s) => s.selectProsePage)
  const addProsePage = useStore((s) => s.addProsePage)
  const removeProsePage = useStore((s) => s.removeProsePage)
  const moveProsePage = useStore((s) => s.moveProsePage)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const words = useMemo(
    () => chapter.pages.map((page) => countWords(blocksText(parseBlocks(page.content)))),
    [chapter.pages],
  )
  const current = chapter.pages.findIndex((page) => page.id === openPageId)
  const index = current === -1 ? 0 : current
  const deleting = chapter.pages.find((page) => page.id === pendingDelete)
  const deletingWords = deleting ? words[chapter.pages.indexOf(deleting)] : 0

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-rule bg-paper-raised/70 px-4 py-1.5 sm:px-6">
      <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-faint">
        Pages
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-slim">
        {chapter.pages.map((page, i) => {
          const selected = i === index
          return (
            <button
              key={page.id}
              className={clsx(
                'shrink-0 rounded-md border px-2 py-0.5 text-xs transition-colors',
                selected
                  ? 'border-accent/40 bg-accent-soft font-semibold text-accent-deep'
                  : 'border-rule text-ink-soft hover:bg-paper-sunk',
              )}
              title={words[i] === 0 ? 'Empty page' : `${formatCount(words[i])} words`}
              aria-current={selected ? 'page' : undefined}
              onClick={() => selectProsePage(page.id)}
            >
              {i + 1}
            </button>
          )
        })}

        <button
          className="btn btn-ghost shrink-0 whitespace-nowrap px-1.5 py-0.5 text-xs"
          title="Add a page to this chapter"
          onClick={() => addProsePage(book.id, chapter.id)}
        >
          <Icons.Plus className="h-3.5 w-3.5" /> Page
        </button>
      </div>

      {chapter.pages.length > 1 && (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-rule pl-1.5">
          <button
            className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-25"
            title="Move this page earlier"
            aria-label="Move this page earlier"
            disabled={index === 0}
            onClick={() => moveProsePage(book.id, chapter.id, index, index - 1)}
          >
            <Icons.Up className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-25"
            title="Move this page later"
            aria-label="Move this page later"
            disabled={index === chapter.pages.length - 1}
            onClick={() => moveProsePage(book.id, chapter.id, index, index + 1)}
          >
            <Icons.Down className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1 text-ink-faint hover:text-red-700"
            title="Delete this page"
            aria-label="Delete this page"
            onClick={() => setPendingDelete(chapter.pages[index].id)}
          >
            <Icons.Trash className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete page ${chapter.pages.indexOf(deleting) + 1}?`}
          body={deletingWords > 0
            ? `This page has ${formatCount(deletingWords)} words. Deleting it cannot be undone.`
            : 'This page is empty. Deleting it cannot be undone.'}
          confirmLabel="Delete page"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { removeProsePage(book.id, chapter.id, deleting.id); setPendingDelete(null) }}
        />
      )}
    </div>
  )
}
