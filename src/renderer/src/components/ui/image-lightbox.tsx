import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'

const MIN_SCALE = 0.25
const MAX_SCALE = 6

function clampScale(next: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 1000) / 1000))
}

function useLightboxTransform(src: string | null) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setDragging(false)
    dragStartRef.current = null
  }, [src])

  const resetZoom = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const applyWheelZoom = useCallback((deltaY: number) => {
    const factor = deltaY < 0 ? 1.15 : 1 / 1.15
    setScale((prev) => {
      const next = clampScale(prev * factor)
      if (next <= 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const st = dragStartRef.current
      if (!st) return
      setOffset({ x: st.ox + (e.clientX - st.x), y: st.oy + (e.clientY - st.y) })
    }
    const onUp = () => {
      dragStartRef.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  const startDrag = (e: React.MouseEvent) => {
    if (scale <= 1 || e.button !== 0) return
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
  }

  const toggleDoubleZoom = () => {
    if (Math.abs(scale - 1) > 0.01) resetZoom()
    else setScale(2)
  }

  return { scale, offset, dragging, resetZoom, applyWheelZoom, startDrag, toggleDoubleZoom }
}

/**
 * Full-window image preview with Ctrl + wheel zoom, pan when zoomed, and double-click reset.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string | null; alt?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const backdropRef = useRef<HTMLDivElement>(null)
  const { scale, offset, dragging, resetZoom, applyWheelZoom, startDrag, toggleDoubleZoom } =
    useLightboxTransform(src)

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        resetZoom()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [src, onClose, resetZoom])

  useEffect(() => {
    const el = backdropRef.current
    if (!src || !el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      applyWheelZoom(e.deltaY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src, applyWheelZoom])

  if (!src) return null

  const zoomed = Math.abs(scale - 1) > 0.01

  return createPortal(
    <div
      ref={backdropRef}
      data-testid="image-lightbox"
      className="overlay-backdrop electron-no-drag fixed inset-0 z-[600] flex items-center justify-center overflow-hidden bg-black/65 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? t('composer:previewImage')}
    >
      <div className="relative flex items-center justify-center">
        <img
          src={src}
          alt={alt ?? ''}
          onMouseDown={startDrag}
          onDoubleClick={toggleDoubleZoom}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          }}
          className={cn(
            'block max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl select-none',
            !dragging && 'transition-transform duration-100 ease-out',
            scale > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
          )}
          draggable={false}
        />
        {!zoomed ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('composer:closePreview')}
            className="absolute -right-3 -top-3 grid h-8 w-8 place-items-center rounded-full border border-border bg-background/95 text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {zoomed ? (
        <div className="fixed right-5 top-5 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={resetZoom}
            className="rounded-full border border-border bg-background/95 px-3 py-1 font-mono text-[12px] font-medium tabular-nums text-foreground shadow-lg transition-colors hover:bg-muted"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('composer:closePreview')}
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background/95 text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
