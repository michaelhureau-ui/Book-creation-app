import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { useStore } from '@/lib/store'
import { ACCEPTED_TYPES, importImage } from '@/lib/graphic/assets'
import { BALLOON_LABELS } from '@/lib/graphic/pages'
import { LAYOUTS } from '@/lib/graphic/layouts'
import type { BalloonKind, Book, Page, Panel } from '@/types'

const BALLOON_KINDS: BalloonKind[] = ['speech', 'thought', 'caption', 'shout', 'sfx']

function Slider({
  label, value, min, max, step, onChange, format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs text-ink-soft">
        {label}
        <span className="tabular-nums text-ink-faint">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        className="w-full accent-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function ArtworkSection({ book, page, panel }: { book: Book; page: Page; panel: Panel }) {
  const updatePanel = useStore((s) => s.updatePanel)
  const clearPanelArt = useStore((s) => s.clearPanelArt)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const place = async (file: File): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const asset = await importImage(book.id, file)
      updatePanel(book.id, page.id, panel.id, { assetId: asset.id, zoom: 1, offsetX: 0, offsetY: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be placed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Artwork</h3>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void place(file)
          e.target.value = ''
        }}
      />

      <div className="flex gap-1.5">
        <button className="btn btn-outline flex-1 text-xs" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Icons.Upload className="h-3.5 w-3.5" />
          {busy ? 'Placing…' : panel.assetId ? 'Replace' : 'Place image'}
        </button>
        {panel.assetId && (
          <button
            className="btn btn-danger text-xs"
            title="Remove artwork"
            onClick={() => clearPanelArt(book.id, page.id, panel.id)}
          >
            <Icons.Trash className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800">
          <Icons.Alert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {panel.assetId ? (
        <div className="space-y-2.5 rounded-lg border border-rule bg-paper-sunk/50 p-2.5">
          <Slider
            label="Zoom" value={panel.zoom} min={1} max={3} step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(zoom) => updatePanel(book.id, page.id, panel.id, { zoom })}
          />
          <Slider
            label="Pan across" value={panel.offsetX} min={-1} max={1} step={0.02}
            onChange={(offsetX) => updatePanel(book.id, page.id, panel.id, { offsetX })}
          />
          <Slider
            label="Pan down" value={panel.offsetY} min={-1} max={1} step={0.02}
            onChange={(offsetY) => updatePanel(book.id, page.id, panel.id, { offsetY })}
          />
          <button
            className="btn btn-ghost w-full py-1 text-xs"
            onClick={() => updatePanel(book.id, page.id, panel.id, { zoom: 1, offsetX: 0, offsetY: 0 })}
          >
            Reset framing
          </button>
        </div>
      ) : (
        <p className="text-xs text-ink-faint">
          Drop in a drawing, a photo, or a scan. It is stored in this browser and cropped to fit the panel.
        </p>
      )}
    </section>
  )
}

function LetteringSection({ book, page, panel }: { book: Book; page: Page; panel: Panel }) {
  const addBalloon = useStore((s) => s.addBalloon)
  const updateBalloon = useStore((s) => s.updateBalloon)
  const removeBalloon = useStore((s) => s.removeBalloon)
  const selectedBalloonId = useStore((s) => s.selectedBalloonId)
  const selectBalloon = useStore((s) => s.selectBalloon)

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Lettering</h3>

      <div className="grid grid-cols-3 gap-1">
        {BALLOON_KINDS.map((kind) => (
          <button
            key={kind}
            className="btn btn-outline whitespace-nowrap px-1 py-1 text-[0.7rem]"
            onClick={() => addBalloon(book.id, page.id, panel.id, kind)}
          >
            + {BALLOON_LABELS[kind]}
          </button>
        ))}
      </div>

      {panel.balloons.length === 0 ? (
        <p className="text-xs text-ink-faint">
          No lettering in this panel yet. Add a balloon, then drag its handles on the page to place it.
        </p>
      ) : (
        <ul className="space-y-2">
          {panel.balloons.map((balloon) => {
            const selected = balloon.id === selectedBalloonId
            return (
              <li
                key={balloon.id}
                className={clsx(
                  'rounded-lg border p-2 transition-colors',
                  selected ? 'border-accent/50 bg-accent-soft/40' : 'border-rule bg-paper-raised',
                )}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <select
                    className="flex-1 rounded-md border border-rule-strong bg-paper-raised px-1.5 py-1 text-xs focus:border-accent focus:outline-none"
                    value={balloon.kind}
                    aria-label="Balloon style"
                    onChange={(e) => updateBalloon(book.id, page.id, panel.id, balloon.id, { kind: e.target.value as BalloonKind })}
                  >
                    {BALLOON_KINDS.map((kind) => (
                      <option key={kind} value={kind}>{BALLOON_LABELS[kind]}</option>
                    ))}
                  </select>
                  <button
                    className="rounded p-1 text-ink-faint hover:text-red-700"
                    title="Delete balloon"
                    aria-label={`Delete ${BALLOON_LABELS[balloon.kind]} balloon`}
                    onClick={() => removeBalloon(book.id, page.id, panel.id, balloon.id)}
                  >
                    <Icons.Trash className="h-3.5 w-3.5" />
                  </button>
                </div>

                <textarea
                  className="field resize-y py-1.5 text-xs"
                  rows={2}
                  value={balloon.text}
                  placeholder="What is said…"
                  aria-label="Balloon text"
                  onFocus={() => selectBalloon(balloon.id)}
                  onChange={(e) => updateBalloon(book.id, page.id, panel.id, balloon.id, { text: e.target.value })}
                />

                <div className="mt-1.5">
                  <Slider
                    label="Width" value={balloon.width} min={0.15} max={0.95} step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(width) => updateBalloon(book.id, page.id, panel.id, balloon.id, { width })}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function PanelInspector({ book, page }: { book: Book; page: Page }) {
  const selectedPanelId = useStore((s) => s.selectedPanelId)
  const setPageLayout = useStore((s) => s.setPageLayout)
  const updatePage = useStore((s) => s.updatePage)
  const panel = page.panels.find((p) => p.id === selectedPanelId) ?? null
  const panelIndex = page.panels.findIndex((p) => p.id === selectedPanelId)

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim">
      <div className="space-y-3 border-b border-rule p-4">
        <label className="block">
          <span className="label">Page title</span>
          <input
            className="field py-1.5 text-sm"
            value={page.title}
            placeholder="Untitled page"
            onChange={(e) => updatePage(book.id, page.id, { title: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="label">Layout</span>
          <select
            className="field py-1.5 text-sm"
            value={page.layout}
            onChange={(e) => setPageLayout(book.id, page.id, e.target.value as typeof page.layout)}
          >
            {LAYOUTS.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.label} · {layout.frames.length} {layout.frames.length === 1 ? 'panel' : 'panels'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {panel ? (
        <div className="space-y-5 p-4">
          <p className="text-sm font-semibold text-ink">Panel {panelIndex + 1}</p>
          <ArtworkSection book={book} page={page} panel={panel} />
          <LetteringSection book={book} page={page} panel={panel} />
        </div>
      ) : (
        <div className="p-4">
          <p className="rounded-lg border border-dashed border-rule-strong px-3 py-6 text-center text-sm text-ink-faint">
            Select a panel on the page to place artwork and add lettering.
          </p>
        </div>
      )}
    </div>
  )
}
