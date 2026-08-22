import { useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { ConfirmDialog } from '@/components/ui'
import { useStore } from '@/lib/store'
import { LAYOUTS, layoutOf } from '@/lib/graphic/layouts'
import type { Book, Page } from '@/types'

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

export function PageList({ book }: { book: Book }) {
  const openPageId = useStore((s) => s.openPageId)
  const selectPage = useStore((s) => s.selectPage)
  const addPage = useStore((s) => s.addPage)
  const movePage = useStore((s) => s.movePage)
  const removePage = useStore((s) => s.removePage)
  const [pendingDelete, setPendingDelete] = useState<Page | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Pages</h2>
        <span className="text-xs text-ink-faint">{book.pages.length}</span>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto px-2 pb-2 scrollbar-slim">
        {book.pages.map((page, index) => {
          const selected = page.id === openPageId
          const filled = page.panels.filter((p) => p.assetId).length
          return (
            <li
              key={page.id}
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
                    {index + 1}. {page.title || 'Untitled page'}
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
                  aria-label={`Move page ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => movePage(book.id, index, index - 1)}
                >
                  <Icons.Up className="h-3.5 w-3.5" />
                </button>
                <button
                  className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-25"
                  title="Move down"
                  aria-label={`Move page ${index + 1} down`}
                  disabled={index === book.pages.length - 1}
                  onClick={() => movePage(book.id, index, index + 1)}
                >
                  <Icons.Down className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                className="absolute bottom-1 right-1 rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-red-700 focus:opacity-100 group-hover:opacity-100"
                title="Delete page"
                aria-label={`Delete page ${index + 1}`}
                onClick={() => setPendingDelete(page)}
              >
                <Icons.Trash className="h-3.5 w-3.5" />
              </button>
            </li>
          )
        })}
        {book.pages.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">No pages yet.</p>
        )}
      </ul>

      <div className="border-t border-rule p-2">
        {adding ? (
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
                  onClick={() => { addPage(book.id, layout.id); setAdding(false) }}
                >
                  <LayoutGlyph
                    page={{ id: '', title: '', layout: layout.id, panels: [] }}
                    className="h-9 w-full text-rule-strong"
                  />
                </button>
              ))}
            </div>
            <button className="btn btn-ghost w-full py-1 text-xs" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-outline w-full py-1.5 text-xs" onClick={() => setAdding(true)}>
            <Icons.Plus className="h-3.5 w-3.5" /> Add page
          </button>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.title || 'this page'}”?`}
          body="The page, its panels, and any artwork placed on it are removed. This cannot be undone."
          confirmLabel="Delete page"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { removePage(book.id, pendingDelete.id); setPendingDelete(null) }}
        />
      )}
    </div>
  )
}
