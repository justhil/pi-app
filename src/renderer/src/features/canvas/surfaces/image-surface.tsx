import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CanvasImagePayload, CanvasSurface } from '@shared/canvas-types'
import {
  CloudDownload,
  Image as ImageIcon,
  MessageSquarePlus,
  RefreshCw,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { CanvasViewport } from '../canvas-viewport'
import { quoteCanvasToComposer, useCanvasStore } from '../canvas-store'
import { useCanvasFileSync } from '../use-canvas-file-sync'

function CompareSlider({
  leftSrc,
  rightSrc,
  leftLabel,
  rightLabel,
}: {
  leftSrc: string
  rightSrc: string
  leftLabel: string
  rightLabel: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(50)
  const [dragging, setDragging] = useState(false)

  const updateFromClientX = (clientX: number) => {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const pct = ((clientX - rect.left) / rect.width) * 100
    setSplit(Math.min(100, Math.max(0, Math.round(pct * 10) / 10)))
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <div
        ref={hostRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          updateFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (dragging) updateFromClientX(e.clientX)
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className="relative max-h-full max-w-full cursor-ew-resize select-none overflow-hidden rounded-lg border border-border/55 bg-[var(--bg-1)] shadow-sm"
      >
        <img
          src={rightSrc}
          alt={rightLabel}
          draggable={false}
          className="block max-h-[72vh] max-w-full object-contain"
        />
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        >
          <img
            src={leftSrc}
            alt={leftLabel}
            draggable={false}
            className="h-full w-full object-contain"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${split}%` }}
        >
          <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/20 bg-white/95 text-[10px] font-bold text-slate-800 shadow">
            ⇔
          </div>
        </div>
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
          {leftLabel}
        </span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
          {rightLabel}
        </span>
      </div>
    </div>
  )
}

export function ImageSurface({ surface }: { surface: CanvasSurface }) {
  const payload = surface.payload as CanvasImagePayload
  const recordInteraction = useCanvasStore((s) => s.recordInteraction)
  const items = payload.images ?? []
  const [activeIdx, setActiveIdx] = useState(0)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)

  const mode =
    payload.mode ??
    (payload.compareSrc || payload.compareFilePath
      ? 'compare'
      : items.length > 1
        ? 'gallery'
        : 'single')

  const activeItem = mode === 'gallery' ? items[Math.min(activeIdx, Math.max(0, items.length - 1))] : undefined
  const primaryFilePath = activeItem?.filePath ?? payload.filePath
  const primarySync = useCanvasFileSync({
    filePath: primaryFilePath,
    watch: payload.watch !== false && Boolean(primaryFilePath),
    mode: 'image',
  })

  const compareSync = useCanvasFileSync({
    filePath: mode === 'compare' ? payload.compareFilePath : undefined,
    watch: payload.watch !== false && mode === 'compare' && Boolean(payload.compareFilePath),
    mode: 'image',
  })

  const primarySrc = primarySync.dataUrl ?? activeItem?.src ?? payload.src ?? ''
  const compareSrc = compareSync.dataUrl ?? payload.compareSrc ?? ''
  const activeCaption = activeItem?.caption ?? payload.caption

  useEffect(() => {
    if (activeIdx >= items.length && items.length > 0) setActiveIdx(0)
  }, [activeIdx, items.length])

  const selectGalleryIndex = (idx: number) => {
    setActiveIdx(idx)
    const item = items[idx]
    recordInteraction(surface.id, {
      selectedImageIndex: idx,
      selectedImageLabel: item?.label ?? item?.id ?? `#${idx + 1}`,
    })
  }

  const downloadCurrent = () => {
    if (!primarySrc) return
    const a = document.createElement('a')
    a.href = primarySrc
    a.download = `${surface.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || 'canvas-image'}.png`
    a.click()
  }

  const quote = () => {
    const abs = primarySync.absPath
    const files = abs
      ? [{ path: abs, name: abs.split(/[\\/]/).pop() || 'image.png', kind: 'image' }]
      : []
    const dims = naturalSize ? ` (${naturalSize.w}×${naturalSize.h})` : ''
    quoteCanvasToComposer(
      `[画布图片 · ${surface.title}${dims}]${activeCaption ? `\n${activeCaption}` : ''}${primaryFilePath ? `\n路径: ${primaryFilePath}` : ''}`,
      files,
    )
    toast.success('已引用图片上下文到输入框')
  }

  return (
    <div data-canvas-surface-id={surface.id} className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/30 px-3 text-[11px] text-foreground-secondary">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px] uppercase">
            {mode === 'compare' ? 'COMPARE' : mode === 'gallery' ? `${activeIdx + 1}/${items.length}` : 'IMAGE'}
          </span>
          {naturalSize ? (
            <span className="font-mono text-[10.5px] tabular-nums opacity-70">
              {naturalSize.w}×{naturalSize.h}
            </span>
          ) : null}
          {primaryFilePath ? (
            <span className="truncate font-mono text-[10.5px] opacity-70" title={primarySync.absPath || primaryFilePath}>
              {primaryFilePath}
            </span>
          ) : null}
          {primarySync.watching ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="文件热重载已开启" />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {primaryFilePath ? (
            <button
              type="button"
              onClick={() => {
                primarySync.reload()
                if (mode === 'compare') compareSync.reload()
              }}
              title="重新加载图片"
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <RefreshCw className={cn('h-3 w-3', primarySync.loading && 'animate-spin')} />
            </button>
          ) : null}
          {primarySrc ? (
            <button
              type="button"
              onClick={downloadCurrent}
              title="下载图片"
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <CloudDownload className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={quote}
            title="引用到对话"
            className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-background px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
          >
            <MessageSquarePlus className="h-3 w-3" />
            <span>引用</span>
          </button>
        </div>
      </div>

      {primarySync.error || compareSync.error ? (
        <div className="border-b border-destructive/30 bg-destructive/[0.06] px-3 py-1.5 text-[11px] text-destructive">
          图片读取失败：{primarySync.error || compareSync.error}
        </div>
      ) : null}

      {mode === 'compare' && primarySrc && compareSrc ? (
        <CompareSlider
          leftSrc={primarySrc}
          rightSrc={compareSrc}
          leftLabel={payload.leftLabel || 'Before'}
          rightLabel={payload.rightLabel || 'After'}
        />
      ) : primarySrc ? (
        <CanvasViewport resetKey={`${surface.id}:${activeIdx}:${primarySrc.slice(0, 64)}`}>
          <img
            src={primarySrc}
            alt={payload.alt || activeItem?.label || surface.title}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
              }
            }}
            className="max-h-[75vh] max-w-full rounded-lg border border-border/40 object-contain shadow-sm"
          />
        </CanvasViewport>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-foreground-secondary">
          <ImageIcon className="h-6 w-6 opacity-45" />
          <span className="text-[12px]">{primarySync.loading ? '正在加载图片…' : '暂无可显示的图片'}</span>
        </div>
      )}

      {mode === 'gallery' && items.length > 1 ? (
        <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border/30 bg-[var(--bg-1)]/50 px-3">
          {items.map((item, idx) => (
            <button
              key={item.id ?? `${idx}`}
              type="button"
              onClick={() => selectGalleryIndex(idx)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors',
                idx === activeIdx
                  ? 'border-foreground/30 bg-background font-medium text-foreground'
                  : 'border-border/40 bg-transparent text-foreground-secondary hover:border-border hover:text-foreground',
              )}
            >
              <span>{item.label || `图 ${idx + 1}`}</span>
            </button>
          ))}
        </div>
      ) : null}

      {activeCaption ? (
        <div className="shrink-0 border-t border-border/25 bg-[var(--bg-1)]/45 px-3 py-1.5 text-[11px] text-foreground-secondary">
          {activeCaption}
        </div>
      ) : null}
    </div>
  )
}
