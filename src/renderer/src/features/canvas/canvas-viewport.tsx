import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Minus, Plus, RotateCcw, Target } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'

const MIN_SCALE = 0.25
const MAX_SCALE = 5

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(s.toFixed(3))))
}

/**
 * Lightweight pan/zoom stage for diagrams, SVGs, and images.
 * - Ctrl/Meta + wheel zooms smoothly toward the pointer.
 * - Pointer drag pans smoothly with grab feedback.
 * - Fit / 1:1 / +/- controls sit in a compact floating toolbar.
 */
export function CanvasViewport({
  children,
  className,
  toolbarExtra,
  resetKey,
}: {
  children: ReactNode
  className?: string
  toolbarExtra?: ReactNode
  /** Reset transform cleanly when the underlying content source changes. */
  resetKey?: string | number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragOriginRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const resetToOne = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const fitToView = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) {
      resetToOne()
      return
    }
    const cw = container.clientWidth - 32
    const ch = container.clientHeight - 32
    const iw = content.scrollWidth
    const ih = content.scrollHeight
    if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) {
      resetToOne()
      return
    }
    const next = clampScale(Math.min(cw / iw, ch / ih, 1.5))
    setScale(next)
    setOffset({ x: 0, y: 0 })
  }, [resetToOne])

  useEffect(() => {
    resetToOne()
  }, [resetKey, resetToOne])

  const zoomBy = useCallback((factor: number) => {
    setScale((prev) => clampScale(prev * factor))
  }, [])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const container = containerRef.current
    const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14
    setScale((prev) => {
      const next = clampScale(prev * factor)
      if (!container || next === prev) return next
      const rect = container.getBoundingClientRect()
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      const ratio = next / prev
      setOffset((o) => ({
        x: cx - (cx - o.x) * ratio,
        y: cy - (cy - o.y) * ratio,
      }))
      return next
    })
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, [data-no-pan="true"]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragOriginRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragOriginRef.current
    if (!start) return
    setOffset({
      x: start.ox + (e.clientX - start.x),
      y: start.oy + (e.clientY - start.y),
    })
  }

  const endDrag = () => {
    dragOriginRef.current = null
    setDragging(false)
  }

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        'relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden bg-[var(--bg-base)]',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
    >
      <div
        ref={contentRef}
        className="flex max-w-none items-center justify-center p-4"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: dragging ? 'none' : 'transform 110ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {children}
      </div>

      {/* Floating zoom / pan control pill */}
      <div
        data-no-pan="true"
        className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-0.5 rounded-lg border border-border/55 bg-background/90 px-1 py-0.5 text-[11px] text-foreground-secondary shadow-sm backdrop-blur-sm"
      >
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.2)}
          title="缩小 (Ctrl+滚轮)"
          aria-label="缩小"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={resetToOne}
          title="重置 100%"
          className="min-w-[42px] rounded px-1 text-center font-mono text-[10.5px] tabular-nums hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.2)}
          title="放大 (Ctrl+滚轮)"
          aria-label="放大"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
        </button>
        <div className="mx-0.5 h-3.5 w-px bg-border/50" />
        <button
          type="button"
          onClick={fitToView}
          title="适应窗口"
          aria-label="适应窗口"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <Target className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={resetToOne}
          title="复位视角"
          aria-label="复位视角"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        {toolbarExtra ? (
          <>
            <div className="mx-0.5 h-3.5 w-px bg-border/50" />
            {toolbarExtra}
          </>
        ) : null}
      </div>
    </div>
  )
}
