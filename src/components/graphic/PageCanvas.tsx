import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Book, Page } from '@/types'
import { drawPage, assetIdsOf, pageGeometry, type TrimId } from '@/lib/graphic/render'
import { loadImages } from '@/lib/graphic/assets'
import { useStore } from '@/lib/store'
import { aspectRatio, balloonHandle, panelRects } from '@/components/graphic/geometry'

/** Screen render resolution — enough to stay crisp on a high-density display. */
const SCREEN_DPI = 150

function useImages(page: Page): Map<string, HTMLImageElement> {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const ids = assetIdsOf([page]).join(',')

  useEffect(() => {
    let live = true
    void loadImages(ids ? ids.split(',') : []).then((loaded) => { if (live) setImages(loaded) })
    return () => { live = false }
  }, [ids])

  return images
}

export function PageCanvas({ book, page, trim }: { book: Book; page: Page; trim: TrimId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const images = useImages(page)
  const [width, setWidth] = useState(0)

  const selectedPanelId = useStore((s) => s.selectedPanelId)
  const selectedBalloonId = useStore((s) => s.selectedBalloonId)
  const selectPanel = useStore((s) => s.selectPanel)
  const selectBalloon = useStore((s) => s.selectBalloon)
  const updateBalloon = useStore((s) => s.updateBalloon)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  // Redraw whenever the page, its artwork, or the display size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // The backing store must match the coordinates the renderer draws in;
    // leaving it at the default 300×150 would show a magnified corner.
    const geo = pageGeometry({ trim, dpi: SCREEN_DPI })
    canvas.width = geo.width
    canvas.height = geo.height
    drawPage(ctx, page, images, { trim, dpi: SCREEN_DPI })
  }, [page, images, trim, width])

  const rects = panelRects(page, trim)

  /** Convert a pointer position into a fraction of the given panel box. */
  const toPanelFraction = (event: PointerEvent | React.PointerEvent, index: number): { x: number; y: number } | null => {
    const wrap = wrapRef.current
    if (!wrap) return null
    const bounds = wrap.getBoundingClientRect()
    const rect = rects[index]
    const px = bounds.left + (rect.left / 100) * bounds.width
    const py = bounds.top + (rect.top / 100) * bounds.height
    const pw = (rect.width / 100) * bounds.width
    const ph = (rect.height / 100) * bounds.height
    return {
      x: Math.min(1.2, Math.max(-0.2, (event.clientX - px) / pw)),
      y: Math.min(1.2, Math.max(-0.2, (event.clientY - py) / ph)),
    }
  }

  const startDrag = (
    event: React.PointerEvent,
    index: number,
    panelId: string,
    balloonId: string,
    handle: 'body' | 'tail',
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    selectPanel(panelId)
    selectBalloon(balloonId)

    const move = (e: PointerEvent): void => {
      const point = toPanelFraction(e, index)
      if (!point) return
      // Dragged by hand, so tidying the lettering leaves it alone from now on.
      updateBalloon(book.id, page.id, panelId, balloonId,
        handle === 'body'
          ? { x: point.x, y: point.y, placed: true }
          : { tailX: point.x, tailY: point.y, placed: true })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={wrapRef}
      className="relative select-none shadow-book"
      // Height-led sizing: the aspect ratio derives the width, and max-width
      // pulls it back in on a narrow window.
      style={{ aspectRatio: String(aspectRatio(trim)), height: '100%', maxWidth: '100%' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full rounded-sm bg-white"
      />

      {page.panels.map((panel, index) => {
        const rect = rects[index]
        if (!rect) return null
        const selected = panel.id === selectedPanelId
        return (
          <div
            key={panel.id}
            className={clsx(
              'absolute cursor-pointer rounded-[1px] transition-shadow',
              selected ? 'ring-2 ring-accent ring-offset-1' : 'hover:ring-2 hover:ring-accent/40',
            )}
            style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
            onPointerDown={() => selectPanel(panel.id)}
            role="button"
            tabIndex={0}
            aria-label={`Panel ${index + 1}`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPanel(panel.id) } }}
          >
            {!panel.assetId && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint">
                Panel {index + 1}
              </span>
            )}

            {selected && panel.balloons.map((balloon) => {
              const handle = balloonHandle(page, index, balloon, trim)
              return (
              <div key={balloon.id}>
                <button
                  className={clsx(
                    'absolute z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 bg-white/90 shadow',
                    balloon.id === selectedBalloonId ? 'border-accent' : 'border-ink/50',
                  )}
                  style={{ left: `${handle.left}%`, top: `${handle.top}%` }}
                  title="Drag to move the balloon"
                  aria-label="Move balloon"
                  onPointerDown={(e) => startDrag(e, index, panel.id, balloon.id, 'body')}
                />
                {balloon.kind !== 'caption' && balloon.kind !== 'sfx' && (
                  <button
                    className={clsx(
                      'absolute z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 shadow',
                      balloon.id === selectedBalloonId ? 'border-accent bg-accent/70' : 'border-ink/40 bg-white/80',
                    )}
                    style={{ left: `${balloon.tailX * 100}%`, top: `${balloon.tailY * 100}%` }}
                    title="Drag to aim the tail"
                    aria-label="Aim balloon tail"
                    onPointerDown={(e) => startDrag(e, index, panel.id, balloon.id, 'tail')}
                  />
                )}
              </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
