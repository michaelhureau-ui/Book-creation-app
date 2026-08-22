import { Icons } from '@/components/Icons'
import { EmptyState } from '@/components/ui'
import { PageCanvas } from '@/components/graphic/PageCanvas'
import { PageList } from '@/components/graphic/PageList'
import { PanelInspector } from '@/components/graphic/PanelInspector'
import { useOpenPage, useStore } from '@/lib/store'
import type { TrimId } from '@/lib/graphic/render'
import { TRIMS } from '@/lib/graphic/render'
import type { Book } from '@/types'

export function GraphicWorkspace({ book, trim, onTrimChange }: {
  book: Book
  trim: TrimId
  onTrimChange: (trim: TrimId) => void
}) {
  const page = useOpenPage()
  const addPage = useStore((s) => s.addPage)
  const selectPanel = useStore((s) => s.selectPanel)
  const pageIndex = book.pages.findIndex((p) => p.id === page?.id)

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-56 shrink-0 border-r border-rule bg-paper-raised/60 lg:block">
        <PageList book={book} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-paper-sunk/40">
        {page ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper-raised px-5 py-2.5">
              <p className="truncate text-sm font-medium text-ink">
                Page {pageIndex + 1}
                {/* Pages are named "Page N" by default; repeating that reads as a glitch. */}
                {page.title && page.title !== `Page ${pageIndex + 1}` && (
                  <span className="ml-2 font-normal text-ink-faint">{page.title}</span>
                )}
              </p>
              <label className="flex items-center gap-2 text-xs text-ink-faint">
                Page size
                <select
                  className="rounded-md border border-rule-strong bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  value={trim}
                  onChange={(e) => onTrimChange(e.target.value as TrimId)}
                >
                  {TRIMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
            </div>

            <div
              className="flex min-h-0 flex-1 flex-col gap-3 p-5"
              // Clicking the surround is the natural way to drop a selection.
              onPointerDown={(e) => { if (e.target === e.currentTarget) selectPanel(null) }}
            >
              {/* The page is sized by the available height so a whole comic
                  page is visible at once, rather than needing to be scrolled. */}
              <div
                className="flex min-h-0 flex-1 items-center justify-center"
                onPointerDown={(e) => { if (e.target === e.currentTarget) selectPanel(null) }}
              >
                <PageCanvas book={book} page={page} trim={trim} />
              </div>
              <p className="shrink-0 text-center text-xs text-ink-faint">
                Click a panel to place artwork. Drag the round handles to move a balloon or aim its tail.
              </p>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Icons.Panels className="h-5 w-5" />}
            title="No pages yet"
            body="A graphic novel is built page by page. Add one and choose how its panels are laid out."
            action={
              <button className="btn btn-primary" onClick={() => addPage(book.id, 'four-grid')}>
                <Icons.Plus /> Add the first page
              </button>
            }
          />
        )}
      </main>

      <aside className="hidden w-72 shrink-0 border-l border-rule bg-paper-raised xl:block">
        {page && <PanelInspector book={book} page={page} />}
      </aside>
    </div>
  )
}
