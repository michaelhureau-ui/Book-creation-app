import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import {
  boardSize, floodFill, parseHex, strokePath, SWATCHES, thin,
  type DrawTool, type Point,
} from '@/lib/graphic/drawing'
import { assetUrl, saveDrawing } from '@/lib/graphic/assets'
import { useStore } from '@/lib/store'
import type { Book, Page, Panel } from '@/types'

/** Undo depth. Each step is a full-canvas snapshot, so this is a memory budget. */
const HISTORY_LIMIT = 25

const TOOLS: { id: DrawTool; label: string; icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'brush', label: 'Brush', icon: Icons.Brush },
  { id: 'line', label: 'Straight line', icon: Icons.Line },
  { id: 'fill', label: 'Fill', icon: Icons.Bucket },
  { id: 'eraser', label: 'Eraser', icon: Icons.Eraser },
]

const SIZES = [2, 4, 8, 16, 32, 56]

export function DrawingBoard({
  book, page, panel, aspect, onClose,
}: {
  book: Book
  page: Page
  panel: Panel
  /** Width ÷ height of the panel this drawing will sit in. */
  aspect: number
  onClose: () => void
}) {
  const setPanelArt = useStore((s) => s.setPanelArt)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const history = useRef<ImageData[]>([])
  const future = useRef<ImageData[]>([])
  const stroke = useRef<Point[]>([])
  const strokeStart = useRef<Point | null>(null)
  /** The canvas as it was before the in-progress stroke, for live line preview. */
  const beforeStroke = useRef<ImageData | null>(null)
  const drawing = useRef(false)

  const [tool, setTool] = useState<DrawTool>('brush')
  const [color, setColor] = useState('#141414')
  const [size, setSize] = useState(8)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const board = boardSize(aspect)

  const refreshHistoryFlags = useCallback(() => {
    setCanUndo(history.current.length > 0)
    setCanRedo(future.current.length > 0)
  }, [])

  const snapshot = useCallback((): ImageData | null => {
    const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    return ctx.getImageData(0, 0, board.width, board.height)
  }, [board.width, board.height])

  const pushHistory = useCallback(() => {
    const image = snapshot()
    if (!image) return
    history.current.push(image)
    if (history.current.length > HISTORY_LIMIT) history.current.shift()
    // Any new mark abandons the redo branch.
    future.current = []
    refreshHistoryFlags()
  }, [snapshot, refreshHistoryFlags])

  // Start from a white sheet, or from whatever the panel already holds so an
  // uploaded photo can be drawn over and a drawing can be picked back up.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = board.width
    canvas.height = board.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, board.width, board.height)

    let live = true
    const load = async (): Promise<void> => {
      if (!panel.assetId) { if (live) setReady(true); return }
      const url = await assetUrl(panel.assetId)
      if (!url || !live) { if (live) setReady(true); return }
      const img = new Image()
      img.onload = () => {
        if (!live) return
        // Cover-fit so the existing art fills the sheet the way the panel shows it.
        const scale = Math.max(board.width / img.naturalWidth, board.height / img.naturalHeight)
        const w = img.naturalWidth * scale
        const h = img.naturalHeight * scale
        ctx.drawImage(img, (board.width - w) / 2, (board.height - h) / 2, w, h)
        setReady(true)
      }
      img.onerror = () => { if (live) setReady(true) }
      img.src = url
    }
    void load()
    return () => { live = false }
  }, [panel.assetId, board.width, board.height])

  /** Pointer position in canvas pixels. */
  const toCanvas = (event: React.PointerEvent | PointerEvent): Point => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * board.width,
      y: ((event.clientY - rect.top) / rect.height) * board.height,
    }
  }

  const applyStrokeStyle = (ctx: CanvasRenderingContext2D): void => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = size
    if (tool === 'eraser') {
      // Erasing paints the paper back rather than punching a hole, so the
      // exported PNG never carries transparency the panel would show through.
      ctx.strokeStyle = '#ffffff'
    } else {
      ctx.strokeStyle = color
    }
  }

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!ready) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx) return
    canvas.setPointerCapture(event.pointerId)
    const point = toCanvas(event)

    if (tool === 'fill') {
      pushHistory()
      const image = ctx.getImageData(0, 0, board.width, board.height)
      if (floodFill(image, point.x, point.y, parseHex(color))) {
        ctx.putImageData(image, 0, 0)
      } else {
        // Nothing changed, so that history entry would be an empty undo step.
        history.current.pop()
        refreshHistoryFlags()
      }
      return
    }

    pushHistory()
    drawing.current = true
    stroke.current = [point]
    strokeStart.current = point
    beforeStroke.current = tool === 'line' ? snapshot() : null
    applyStrokeStyle(ctx)
    strokePath(ctx, [point])
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const point = toCanvas(event)

    if (tool === 'line') {
      // Redraw from the pre-stroke snapshot so the line follows the pointer.
      if (beforeStroke.current) ctx.putImageData(beforeStroke.current, 0, 0)
      applyStrokeStyle(ctx)
      const from = strokeStart.current ?? point
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()
      stroke.current = [from, point]
      return
    }

    stroke.current = thin([...stroke.current, point])
    applyStrokeStyle(ctx)
    strokePath(ctx, stroke.current)
  }

  const endStroke = (): void => {
    drawing.current = false
    stroke.current = []
    strokeStart.current = null
    beforeStroke.current = null
  }

  const undo = useCallback((): void => {
    const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true })
    const previous = history.current.pop()
    if (!ctx || !previous) return
    const current = ctx.getImageData(0, 0, board.width, board.height)
    future.current.push(current)
    ctx.putImageData(previous, 0, 0)
    refreshHistoryFlags()
  }, [board.width, board.height, refreshHistoryFlags])

  const redo = useCallback((): void => {
    const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true })
    const next = future.current.pop()
    if (!ctx || !next) return
    const current = ctx.getImageData(0, 0, board.width, board.height)
    history.current.push(current)
    ctx.putImageData(next, 0, 0)
    refreshHistoryFlags()
  }, [board.width, board.height, refreshHistoryFlags])

  const clear = (): void => {
    const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    pushHistory()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, board.width, board.height)
  }

  const save = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas) return
    setSaving(true)
    setError(null)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('The drawing could not be saved.'))),
          'image/png',
        )
      })
      const asset = await saveDrawing(book.id, blob, board.width, board.height)
      setPanelArt(book.id, page.id, panel.id, asset.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The drawing could not be saved.')
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { onClose(); return }
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, undo, redo])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/45 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-rule bg-paper-raised shadow-card">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
          <h2 className="mr-2 text-sm font-semibold text-ink">Draw this panel</h2>

          <div className="flex items-center gap-0.5 rounded-lg border border-rule p-0.5">
            {TOOLS.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={tool === option.id}
                  className={clsx(
                    'rounded-md p-1.5 transition-colors',
                    tool === option.id ? 'bg-accent-soft text-accent-deep' : 'text-ink-soft hover:bg-paper-sunk',
                  )}
                  onClick={() => setTool(option.id)}
                >
                  <Icon className="h-4 w-4" />
                </button>
              )
            })}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-ink-faint">
            Size
            <select
              className="rounded-md border border-rule-strong bg-paper-raised px-1.5 py-1 text-xs text-ink focus:border-accent focus:outline-none"
              value={size}
              aria-label="Brush size"
              onChange={(e) => setSize(Number(e.target.value))}
            >
              {SIZES.map((s) => <option key={s} value={s}>{s} px</option>)}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <div className="flex flex-wrap gap-0.5">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  title={swatch}
                  aria-label={`Colour ${swatch}`}
                  aria-pressed={color.toLowerCase() === swatch}
                  className={clsx(
                    'h-5 w-5 rounded border transition-transform',
                    color.toLowerCase() === swatch ? 'scale-110 border-accent' : 'border-rule hover:scale-105',
                  )}
                  style={{ background: swatch }}
                  onClick={() => { setColor(swatch); if (tool === 'eraser') setTool('brush') }}
                />
              ))}
            </div>
            <input
              type="color"
              className="h-6 w-8 cursor-pointer rounded border border-rule bg-paper-raised"
              value={color}
              aria-label="Custom colour"
              onChange={(e) => { setColor(e.target.value); if (tool === 'eraser') setTool('brush') }}
            />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button className="btn btn-ghost px-2" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}>
              <Icons.Undo className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost px-2" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}>
              <Icons.Redo className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost text-xs" onClick={clear}>Clear</button>
            <button className="btn btn-outline text-xs" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary text-xs" onClick={() => void save()} disabled={saving || !ready}>
              <Icons.Check className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Place in panel'}
            </button>
          </div>
        </header>

        {error && (
          <p className="flex shrink-0 items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            <Icons.Alert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <div ref={wrapRef} className="flex min-h-0 flex-1 items-center justify-center bg-paper-sunk p-4">
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full rounded-sm bg-white shadow-book"
            style={{ aspectRatio: String(aspect), touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
          />
        </div>

        <p className="shrink-0 border-t border-rule px-4 py-2 text-center text-xs text-ink-faint">
          The sheet matches this panel’s shape, so what you draw is what the panel shows.
          {panel.assetId && ' The artwork already in the panel is loaded so you can draw over it.'}
        </p>
      </div>
    </div>
  )
}
