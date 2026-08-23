import { useEffect, useState } from 'react'
import { Icons } from '@/components/Icons'
import { Drawer, EmptyState } from '@/components/ui'
import { useMediaQuery } from '@/lib/useNarrow'
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
  const setPageChapter = useStore((s) => s.setPageChapter)
  const selectPanel = useStore((s) => s.selectPanel)
  const selectedPanelId = useStore((s) => s.selectedPanelId)
  const pageIndex = book.pages.findIndex((p) => p.id === page?.id)

  // Each side panel is rendered in exactly one place — docked or in a drawer,
  // never both. Two mounted copies would mean two sets of controls with the
  // same labels and two copies of the inspector's own state.
  const pagesDocked = useMediaQuery('(min-width: 1024px)')
  const inspectorDocked = useMediaQuery('(min-width: 1280px)')
  const [drawer, setDrawer] = useState<'pages' | 'panel' | null>(null)

  // On a phone the inspector is not on screen, so tapping a panel has to bring
  // it up — otherwise a tap appears to do nothing at all.
  useEffect(() => {
    if (!inspectorDocked && selectedPanelId) setDrawer('panel')
  }, [inspectorDocked, selectedPanelId])

  // Docking a panel again makes its drawer redundant.
  useEffect(() => {
    setDrawer((open) => {
      if (open === 'panel' && inspectorDocked) return null
      if (open === 'pages' && pagesDocked) return null
      return open
    })
  }, [inspectorDocked, pagesDocked])

  return (
    <div className="flex min-h-0 flex-1">
      {pagesDocked && (
        <aside className="w-56 shrink-0 border-r border-rule bg-paper-raised/60">
          <PageList book={book} />
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-paper-sunk/40">
        {page ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-rule bg-paper-raised px-3 py-2.5 sm:px-5">
              {!pagesDocked && (
                <button
                  className="btn btn-outline shrink-0 px-2 py-1 text-xs"
                  onClick={() => setDrawer('pages')}
                >
                  <Icons.Panels className="h-3.5 w-3.5" /> Pages
                </button>
              )}
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                Page {pageIndex + 1}
                {/* Pages are named "Page N" by default; repeating that reads as a glitch. */}
                {page.title && page.title !== `Page ${pageIndex + 1}` && (
                  <span className="ml-2 font-normal text-ink-faint">{page.title}</span>
                )}
              </p>
              {!inspectorDocked && (
                <button
                  className="btn btn-primary shrink-0 px-2 py-1 text-xs"
                  onClick={() => setDrawer('panel')}
                >
                  <Icons.Pencil className="h-3.5 w-3.5" /> Panel
                </button>
              )}
              {book.chapters.length > 0 && (
                <label className="hidden items-center gap-2 text-xs text-ink-faint sm:flex">
                  Chapter
                  <select
                    className="max-w-[10rem] rounded-md border border-rule-strong bg-paper-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                    value={page.chapterId ?? ''}
                    onChange={(e) => setPageChapter(book.id, page.id, e.target.value || null)}
                  >
                    <option value="">Not in a chapter</option>
                    {book.chapters.map((chapter, i) => (
                      <option key={chapter.id} value={chapter.id}>
                        {i + 1}. {chapter.title || 'Untitled chapter'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="hidden items-center gap-2 text-xs text-ink-faint sm:flex">
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

      {inspectorDocked && (
        <aside className="w-72 shrink-0 border-l border-rule bg-paper-raised">
          {page && <PanelInspector book={book} page={page} />}
        </aside>
      )}

      {drawer === 'pages' && !pagesDocked && (
        <Drawer title="Pages" side="left" onClose={() => setDrawer(null)}>
          <PageList book={book} />
        </Drawer>
      )}
      {drawer === 'panel' && !inspectorDocked && page && (
        <Drawer title={`Page ${pageIndex + 1}`} onClose={() => setDrawer(null)}>
          <PanelInspector book={book} page={page} />
        </Drawer>
      )}
    </div>
  )
}
