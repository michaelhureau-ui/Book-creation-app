import { useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { Modal } from '@/components/ui'
import { exportBook, FORMAT_LABELS, GRAPHIC_FORMATS, PROSE_FORMATS, type ExportFormat } from '@/lib/export'
import { DEFAULT_PDF_OPTIONS, TRIM_LABELS, type PdfOptions, type TrimSize } from '@/lib/export/pdf-options'
import { DEFAULT_COMIC_OPTIONS, DPI_CHOICES, type ComicOptions } from '@/lib/export/comic-options'
import { TRIMS, type TrimId } from '@/lib/graphic/render'
import { bookStats, formatCount } from '@/lib/stats'
import type { Book } from '@/types'

const FONT_SIZES = [10, 10.5, 11, 12, 13]

export function ExportDialog({ book, trim = 'comic', onClose }: { book: Book; trim?: TrimId; onClose: () => void }) {
  const graphic = book.kind === 'graphic'
  const formats = graphic ? GRAPHIC_FORMATS : PROSE_FORMATS
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [pdf, setPdf] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS)
  const [comic, setComic] = useState<ComicOptions>({ ...DEFAULT_COMIC_OPTIONS, trim })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stats = bookStats(book)
  const empty = graphic ? stats.artworkPlaced === 0 : stats.words === 0

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await exportBook(book, format, { pdf, comic })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Export"
      subtitle={graphic
        ? `${stats.pages} ${stats.pages === 1 ? 'page' : 'pages'}, ${stats.artworkPlaced} of ${stats.panels} panels drawn.`
        : `${formatCount(stats.words)} words across ${book.chapters.length} ${book.chapters.length === 1 ? 'section' : 'sections'}.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy}>
            <Icons.Download /> {busy ? 'Building…' : `Download ${FORMAT_LABELS[format].name}`}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {empty && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <Icons.Alert className="mt-0.5 h-4 w-4 shrink-0" />
            {graphic
              ? 'No artwork has been placed yet. The export will show empty panels and any lettering you have written.'
              : 'This book has no text yet. The export will contain only the title page and chapter headings.'}
          </p>
        )}

        <div>
          <span className="label">Format</span>
          <div className="space-y-1.5">
            {formats.map((f) => (
              <button
                key={f}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  format === f ? 'border-accent bg-accent-soft/50' : 'border-rule hover:bg-paper-sunk',
                )}
                aria-pressed={format === f}
                onClick={() => setFormat(f)}
              >
                <span
                  className={clsx(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    format === f ? 'border-accent bg-accent text-white' : 'border-rule-strong',
                  )}
                >
                  {format === f && <Icons.Check className="h-2.5 w-2.5" />}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{FORMAT_LABELS[f].name}</span>
                  <span className="block text-xs text-ink-faint">{FORMAT_LABELS[f].hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {graphic && (format === 'pdf' || format === 'cbz') && (
          <div className="space-y-3 rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <label className="block">
              <span className="label">Page size</span>
              <select
                className="field"
                value={comic.trim}
                onChange={(e) => setComic({ ...comic, trim: e.target.value as TrimId })}
              >
                {TRIMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="label">Resolution</span>
              <select
                className="field"
                value={comic.dpi}
                onChange={(e) => setComic({ ...comic, dpi: Number(e.target.value) })}
              >
                {DPI_CHOICES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-ink-faint">
                Higher resolution means a sharper — and much larger — file.
              </span>
            </label>

            {([
              ['includeTitlePage', 'Title page'],
              ['borders', 'Panel borders'],
              ...(format === 'pdf' ? [['printReady', 'Print-ready (bleed and crop marks)'] as const] : []),
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-rule-strong accent-accent"
                  checked={comic[key]}
                  onChange={(e) => setComic({ ...comic, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        )}

        {!graphic && format === 'pdf' && (
          <div className="space-y-3 rounded-lg border border-rule bg-paper-sunk/60 p-3">
            <label className="block">
              <span className="label">Page size</span>
              <select
                className="field"
                value={pdf.trim}
                onChange={(e) => setPdf({ ...pdf, trim: e.target.value as TrimSize })}
              >
                {(Object.keys(TRIM_LABELS) as TrimSize[]).map((t) => (
                  <option key={t} value={t}>{TRIM_LABELS[t]}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label">Body text size</span>
              <select
                className="field"
                value={pdf.fontSize}
                onChange={(e) => setPdf({ ...pdf, fontSize: Number(e.target.value) })}
              >
                {FONT_SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
              </select>
            </label>

            {([
              ['includeTitlePage', 'Title page'],
              ['includeToc', 'Table of contents'],
              ['includePageNumbers', 'Page numbers'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-rule-strong accent-accent"
                  checked={pdf[key]}
                  onChange={(e) => setPdf({ ...pdf, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <Icons.Alert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
