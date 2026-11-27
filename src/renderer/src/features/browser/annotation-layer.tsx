import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  formatAnnotationsForComposer,
  type BrowserAnnotation,
  type ComposerLabels,
  type ElementDescriptor,
} from '@shared/browser-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { cropRect, isDrag, placeBeside, rectFromPoints, stackLayout, type Rect } from './annotation-geometry'
import { saveImageAttachment, sendToComposer } from './browser-composer'

type DrawTool = 'select' | 'arrow' | 'rect' | 'ellipse'

interface MarkupStroke {
  kind: 'arrow' | 'rect' | 'ellipse'
  x1: number
  y1: number
  x2: number
  y2: number
  frame: number
}

interface Item extends BrowserAnnotation {
  rect: Rect
  frame: number
  crop: HTMLCanvasElement
}

interface Pending {
  rect: Rect
  element?: ElementDescriptor
  extraElements?: ElementDescriptor[]
  area?: Rect
}

const EDITOR_SIZE = { width: 296, height: 124 }
const uiZoom = () => Number(document.documentElement.style.zoom) || 1

function px(rect: Rect) {
  const z = uiZoom()
  return { left: rect.x / z, top: rect.y / z, width: rect.width / z, height: rect.height / z }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function unionRects(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  return { x: minX, y: minY, width: Math.max(8, maxX - minX), height: Math.max(8, maxY - minY) }
}

function drawStrokeOnCanvas(
  ctx: CanvasRenderingContext2D,
  s: MarkupStroke,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const x1 = s.x1 * scale - offsetX
  const y1 = s.y1 * scale - offsetY
  const x2 = s.x2 * scale - offsetX
  const y2 = s.y2 * scale - offsetY
  ctx.save()
  ctx.strokeStyle = '#ef4444'
  ctx.fillStyle = '#ef4444'
  ctx.lineWidth = Math.max(2.5, 2.5 * scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.kind === 'rect') {
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
  } else if (s.kind === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (s.kind === 'arrow') {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = Math.max(10, 10 * scale)
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Cursor Design Mode-inspired annotation overlay on a frozen page frame (zero DOM mutation):
 * - Hover element inspection + ArrowUp/ArrowDown parent/child DOM stepping
 * - Shift+Click multi-element selection
 * - Area box drag + lightweight markup tools (Arrow / Rect / Ellipse) with Ctrl/Cmd+Z undo
 * - Keeps Browser Stage split-view open when sending directly to Composer!
 */
export function AnnotationLayer({
  tabId,
  page,
  initialSnapshot,
  onExit,
}: {
  tabId: string
  page: { title: string; url: string }
  initialSnapshot: string
  onExit: () => void
}) {
  const { t } = useTranslation('browser')
  const rootRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [frame, setFrame] = useState(0)
  const [tool, setTool] = useState<DrawTool>('select')
  const [hover, setHover] = useState<ElementDescriptor | null>(null)
  const [ancestorDepth, setAncestorDepth] = useState(0)
  const [multiSelected, setMultiSelected] = useState<ElementDescriptor[]>([])
  const [dragRect, setDragRect] = useState<Rect | null>(null)
  const [draftStroke, setDraftStroke] = useState<MarkupStroke | null>(null)
  const [strokes, setStrokes] = useState<MarkupStroke[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [comment, setComment] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [finishing, setFinishing] = useState(false)
  const pressRef = useRef<{ x: number; y: number } | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const hoverReq = useRef(0)
  const imgRef = useRef<HTMLImageElement>(null)
  const wheel = useRef({ unsent: 0, uncaptured: 0, x: 0, y: 0, idle: 0, gen: 0, scrolling: false })

  const local = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const inspect = useCallback(
    (x: number, y: number, deep: boolean, steps = 0) =>
      ipcClient
        .invoke('browser.inspectPoint', { tabId, x, y, deep, ancestorSteps: steps })
        .then((res: { element?: ElementDescriptor | null }) => res?.element ?? null)
        .catch(() => null),
    [tabId],
  )

  const onPointerMove = (e: ReactPointerEvent) => {
    if (pending || finishing || wheel.current.scrolling) return
    const p = local(e)
    lastPointerRef.current = p
    if (pressRef.current) {
      if (tool !== 'select') {
        setDraftStroke({
          kind: tool,
          x1: pressRef.current.x,
          y1: pressRef.current.y,
          x2: p.x,
          y2: p.y,
          frame,
        })
        return
      }
      if (isDrag(pressRef.current.x, pressRef.current.y, p.x, p.y)) {
        setDragRect(rectFromPoints(pressRef.current.x, pressRef.current.y, p.x, p.y))
      }
      return
    }
    if (tool !== 'select') return
    const req = ++hoverReq.current
    requestAnimationFrame(() => {
      if (req !== hoverReq.current) return
      void inspect(p.x, p.y, false, ancestorDepth).then((el) => {
        if (req === hoverReq.current) setHover(el)
      })
    })
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (pending || finishing || e.button !== 0) return
    pressRef.current = local(e)
    rootRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerUp = async (e: ReactPointerEvent) => {
    const start = pressRef.current
    pressRef.current = null
    if (!start || pending || finishing) return
    const p = local(e)

    if (tool !== 'select') {
      setDraftStroke(null)
      if (isDrag(start.x, start.y, p.x, p.y)) {
        setStrokes((prev) => [...prev, { kind: tool, x1: start.x, y1: start.y, x2: p.x, y2: p.y, frame }])
      }
      return
    }

    setDragRect(null)
    if (isDrag(start.x, start.y, p.x, p.y)) {
      const area = rectFromPoints(start.x, start.y, p.x, p.y)
      setPending({ rect: area, area })
      setHover(null)
      setComment('')
      return
    }

    const element = await inspect(p.x, p.y, true, ancestorDepth)
    if (!element) return

    if (e.shiftKey) {
      // Shift+Click multi-select elements into a group
      setMultiSelected((prev) => {
        if (prev.some((el) => el.selector === element.selector)) return prev
        return [...prev, element]
      })
      return
    }

    if (multiSelected.length > 0) {
      const combined = multiSelected.some((el) => el.selector === element.selector)
        ? multiSelected
        : [...multiSelected, element]
      setPending({
        rect: unionRects(combined.map((el) => el.rect)),
        element: combined[0],
        extraElements: combined.slice(1),
      })
      setMultiSelected([])
    } else {
      setPending({ rect: element.rect, element })
    }
    setHover(null)
    setComment('')
  }

  const setShift = (pxDelta: number) => {
    if (imgRef.current) imgRef.current.style.transform = pxDelta ? `translate3d(0, ${-pxDelta / uiZoom()}px, 0)` : ''
  }

  const settleScroll = useCallback(async () => {
    const w = wheel.current
    const gen = ++w.gen
    const delta = w.unsent
    w.unsent = 0
    w.uncaptured += delta
    await ipcClient.invoke('browser.scroll', { tabId, x: w.x, y: w.y, deltaY: delta }).catch(() => {})
    await new Promise((r) => setTimeout(r, 120))
    if (gen !== w.gen) return
    const res = (await ipcClient.invoke('browser.capture', { tabId }).catch(() => null)) as {
      dataUrl?: string | null
    } | null
    if (gen !== w.gen) return
    if (res?.dataUrl) {
      const next = new Image()
      next.src = res.dataUrl
      await next.decode().catch(() => undefined)
      if (gen !== w.gen) return
      setSnapshot(res.dataUrl)
      setFrame((f) => f + 1)
    }
    w.uncaptured = 0
    w.scrolling = false
    requestAnimationFrame(() => setShift(w.unsent))
  }, [tabId])

  const onWheel = (e: React.WheelEvent) => {
    if (pending || finishing) return
    const p = local(e)
    const w = wheel.current
    const delta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * p.y : e.deltaY
    w.gen++
    w.unsent += delta
    w.x = p.x
    w.y = p.y
    if (!w.scrolling) {
      w.scrolling = true
      setHover(null)
    }
    setShift(w.unsent + w.uncaptured)
    window.clearTimeout(w.idle)
    w.idle = window.setTimeout(() => void settleScroll(), 140)
  }

  const commit = async () => {
    if (!pending) return
    const root = rootRef.current
    if (!root) return
    const img = await loadImage(snapshot)
    const r = root.getBoundingClientRect()
    const scale = img.naturalWidth / r.width
    const c = cropRect(pending.rect, { width: r.width, height: r.height }, scale)
    const canvas = document.createElement('canvas')
    canvas.width = c.width
    canvas.height = c.height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height)
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = Math.max(2, 2 * scale)
      if (pending.extraElements?.length && pending.element) {
        for (const el of [pending.element, ...pending.extraElements]) {
          ctx.strokeRect(el.rect.x * scale - c.x, el.rect.y * scale - c.y, el.rect.width * scale, el.rect.height * scale)
        }
      } else {
        ctx.strokeRect(
          pending.rect.x * scale - c.x,
          pending.rect.y * scale - c.y,
          pending.rect.width * scale,
          pending.rect.height * scale,
        )
      }
      // Bake any markup strokes drawn on this frame into the crop!
      for (const s of strokes.filter((st) => st.frame === frame)) {
        drawStrokeOnCanvas(ctx, s, scale, c.x, c.y)
      }
    }
    const extraNote = pending.extraElements?.length
      ? `[+${pending.extraElements.length} elements: ${pending.extraElements.map((e) => e.selector).join(', ')}] `
      : ''
    setItems((prev) => [
      ...prev,
      {
        index: prev.length + 1,
        comment: (extraNote + comment).trim(),
        element: pending.element,
        area: pending.area,
        rect: pending.rect,
        frame,
        crop: canvas,
      },
    ])
    setPending(null)
    setComment('')
  }

  const finish = async () => {
    const hasStrokesOnly = items.length === 0 && strokes.filter((s) => s.frame === frame).length > 0
    if (items.length === 0 && !hasStrokesOnly) return
    setFinishing(true)
    try {
      let exportItems = items
      if (hasStrokesOnly && rootRef.current) {
        const img = await loadImage(snapshot)
        const r = rootRef.current.getBoundingClientRect()
        const scale = img.naturalWidth / r.width
        const frameStrokes = strokes.filter((s) => s.frame === frame)
        const bounds = unionRects(
          frameStrokes.map((s) => rectFromPoints(s.x1, s.y1, s.x2, s.y2)),
        )
        const c = cropRect(bounds, { width: r.width, height: r.height }, scale)
        const canvas = document.createElement('canvas')
        canvas.width = c.width
        canvas.height = c.height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height)
          for (const s of frameStrokes) drawStrokeOnCanvas(ctx, s, scale, c.x, c.y)
        }
        exportItems = [{ index: 1, comment: t('annotate.area'), area: bounds, rect: bounds, frame, crop: canvas }]
      }

      const layout = stackLayout(exportItems.map((i) => ({ width: i.crop.width, height: i.crop.height })))
      const canvas = document.createElement('canvas')
      canvas.width = layout.width
      canvas.height = layout.height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        exportItems.forEach((item, i) => {
          const box = layout.placed[i]
          ctx.fillStyle = '#ef4444'
          ctx.fillRect(0, box.labelY + 2, 36, 22)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 14px sans-serif'
          ctx.fillText(`#${item.index}`, 6, box.labelY + 18)
          ctx.fillStyle = '#111827'
          ctx.font = '13px sans-serif'
          ctx.fillText(item.comment.trim().slice(0, 90), 44, box.labelY + 18)
          ctx.drawImage(item.crop, box.x, box.y, box.width, box.height)
        })
      }
      const file = await saveImageAttachment(canvas.toDataURL('image/png'), `browser-annotations-${Date.now()}.png`)
      const labels: ComposerLabels = {
        annotations: t('composer.annotations'),
        logs: t('composer.logs'),
        noLogs: t('composer.noLogs'),
        area: t('composer.area'),
        page: t('composer.page'),
        noComment: t('composer.noComment'),
      }
      sendToComposer({ text: formatAnnotationsForComposer(page, exportItems, labels), files: [file] })
      onExit()
    } catch (error) {
      console.error('[browser] annotations export failed:', error)
      toast.error(t('annotate.exportFailed'))
      setFinishing(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (pending) setPending(null)
        else if (multiSelected.length > 0) setMultiSelected([])
        else onExit()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !pending) {
        e.preventDefault()
        if (strokes.length > 0) setStrokes((prev) => prev.slice(0, -1))
        else if (items.length > 0) setItems((prev) => prev.slice(0, -1))
        return
      }
      // Cursor Design Mode: ArrowUp / ArrowDown walks parent / child elements under cursor!
      if (!pending && tool === 'select' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const pt = lastPointerRef.current
        if (!pt) return
        e.preventDefault()
        const nextDepth = e.key === 'ArrowUp' ? Math.min(12, ancestorDepth + 1) : Math.max(0, ancestorDepth - 1)
        setAncestorDepth(nextDepth)
        void inspect(pt.x, pt.y, false, nextDepth).then((el) => {
          if (el) setHover(el)
        })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, multiSelected.length, strokes.length, items.length, tool, ancestorDepth, inspect, onExit])

  useEffect(
    () => () => {
      const w = wheel.current
      window.clearTimeout(w.idle)
      w.gen++
    },
    [],
  )

  const rootRect = rootRef.current?.getBoundingClientRect()
  const editorPos =
    pending && rootRect
      ? placeBeside(
          pending.rect,
          { width: EDITOR_SIZE.width * uiZoom(), height: EDITOR_SIZE.height * uiZoom() },
          { width: rootRect.width, height: rootRect.height },
        )
      : null
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const frameStrokes = strokes.filter((s) => s.frame === frame)
  const visibleStrokes = draftStroke ? [...frameStrokes, draftStroke] : frameStrokes
  const totalReady = items.length + (items.length === 0 && frameStrokes.length > 0 ? 1 : 0)

  return (
    <div
      ref={rootRef}
      className={cn('absolute inset-0 z-20 select-none overflow-hidden', pending ? 'cursor-default' : 'cursor-crosshair')}
      data-annotation-layer=""
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={(e) => void onPointerUp(e)}
      onPointerLeave={() => setHover(null)}
      onWheel={onWheel}
    >
      <img
        ref={imgRef}
        src={snapshot}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full will-change-transform"
      />

      {/* SVG Markup Strokes Layer (Arrow / Rect / Ellipse) */}
      {visibleStrokes.length > 0 && !wheel.current.scrolling ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <defs>
            <marker id="pi-anno-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill="#ef4444" />
            </marker>
          </defs>
          {visibleStrokes.map((s, idx) => {
            const z = uiZoom()
            const x1 = s.x1 / z
            const y1 = s.y1 / z
            const x2 = s.x2 / z
            const y2 = s.y2 / z
            if (s.kind === 'rect') {
              return (
                <rect
                  key={idx}
                  x={Math.min(x1, x2)}
                  y={Math.min(y1, y2)}
                  width={Math.abs(x2 - x1)}
                  height={Math.abs(y2 - y1)}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="2.2"
                  rx="3"
                />
              )
            }
            if (s.kind === 'ellipse') {
              return (
                <ellipse
                  key={idx}
                  cx={(x1 + x2) / 2}
                  cy={(y1 + y2) / 2}
                  rx={Math.abs(x2 - x1) / 2}
                  ry={Math.abs(y2 - y1) / 2}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="2.2"
                />
              )
            }
            return (
              <line
                key={idx}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#ef4444"
                strokeWidth="2.2"
                markerEnd="url(#pi-anno-arrow)"
              />
            )
          })}
        </svg>
      ) : null}

      {/* Hover DOM highlight */}
      {hover && !pending && !dragRect && tool === 'select' ? (
        <div className="pointer-events-none absolute border-2 border-[#3b82f6] bg-[#3b82f6]/10" style={px(hover.rect)}>
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#3b82f6] px-1.5 text-[10.5px] leading-4 text-white shadow-xs">
            {hover.components?.[0] ? `<${hover.components[0]}> ` : ''}
            {hover.tag}
            {hover.classes[0] ? `.${hover.classes[0]}` : ''} · {Math.round(hover.rect.width)}×
            {Math.round(hover.rect.height)}
            {ancestorDepth > 0 ? ` · ↑${ancestorDepth}` : ''}
          </span>
        </div>
      ) : null}

      {/* Shift+Click Multi-selected elements */}
      {multiSelected.map((el, idx) => (
        <div
          key={`ms-${idx}`}
          className="pointer-events-none absolute border-2 border-dashed border-[#3b82f6] bg-[#3b82f6]/12"
          style={px(el.rect)}
        >
          <span className="absolute -left-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#3b82f6] px-1 text-[10px] font-semibold text-white">
            +{idx + 1}
          </span>
        </div>
      ))}

      {dragRect ? (
        <div className="pointer-events-none absolute border-2 border-dashed border-[#ef4444] bg-[#ef4444]/10" style={px(dragRect)} />
      ) : null}

      {items
        .filter((item) => item.frame === frame && !wheel.current.scrolling)
        .map((item) => (
          <div key={item.index} className="pointer-events-none absolute border-2 border-[#ef4444]" style={px(item.rect)}>
            <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[11px] font-semibold text-white">
              {item.index}
            </span>
          </div>
        ))}

      {pending && editorPos ? (
        <>
          <div className="pointer-events-none absolute border-2 border-[#ef4444] bg-[#ef4444]/10" style={px(pending.rect)} />
          <div
            className="absolute z-30 flex flex-col gap-1.5 rounded-lg border border-border/60 bg-popover p-2.5 text-popover-foreground shadow-xl"
            style={{ left: editorPos.x / uiZoom(), top: editorPos.y / uiZoom(), width: EDITOR_SIZE.width }}
            onPointerDown={stop}
            onPointerUp={stop}
            onPointerMove={stop}
            onWheel={stop}
          >
            <div className="truncate text-[11px] font-medium text-foreground-secondary">
              {pending.element
                ? `<${pending.element.components?.[0] || pending.element.tag}> ${pending.element.name || pending.element.text || ''}${
                    pending.extraElements?.length ? ` (+${pending.extraElements.length})` : ''
                  }`
                : t('annotate.area')}
            </div>
            <textarea
              autoFocus
              rows={2}
              value={comment}
              placeholder={t('annotate.placeholder')}
              aria-label={t('annotate.placeholder')}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void commit()
                }
              }}
              className="w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground outline-none focus:border-[var(--brand)]"
            />
            <div className="flex items-center justify-end gap-1.5 text-[11px]">
              <span className="mr-auto text-foreground-tertiary">{t('annotate.enterHint')}</span>
              <button
                type="button"
                className="rounded px-2 py-0.5 hover:bg-[var(--bg-hover)]"
                onClick={() => setPending(null)}
              >
                {t('annotate.cancel')}
              </button>
              <button
                type="button"
                className="rounded bg-foreground px-2.5 py-0.5 font-medium text-background"
                onClick={() => void commit()}
              >
                {t('annotate.add')}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Floating Design Mode Toolbar */}
      <div
        className="absolute inset-x-2.5 bottom-2.5 z-30 flex flex-wrap items-center gap-1.5 rounded-xl border border-border/75 bg-popover/95 px-2.5 py-1.5 text-[11.5px] text-popover-foreground shadow-lg backdrop-blur-md"
        onPointerDown={stop}
        onPointerUp={stop}
        onPointerMove={stop}
        onWheel={stop}
      >
        <div className="flex items-center gap-0.5 rounded-md bg-[var(--bg-2)]/75 p-0.5">
          {(['select', 'arrow', 'rect', 'ellipse'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTool(k)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                tool === k ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`annotate.tool.${k}`)}
            </button>
          ))}
        </div>

        <span className="min-w-0 flex-1 truncate text-foreground-secondary">
          {multiSelected.length > 0
            ? t('annotate.multiHint', { count: multiSelected.length })
            : items.length > 0
              ? t('annotate.count', { count: items.length })
              : t('annotate.hintRich')}
        </span>

        <button
          type="button"
          disabled={items.length === 0 && strokes.length === 0}
          className="rounded px-2 py-0.5 hover:bg-[var(--bg-hover)] disabled:opacity-40"
          onClick={() => {
            if (strokes.length > 0) setStrokes((prev) => prev.slice(0, -1))
            else setItems((prev) => prev.slice(0, -1))
          }}
        >
          {t('annotate.undo')}
        </button>
        <button type="button" className="rounded px-2 py-0.5 hover:bg-[var(--bg-hover)]" onClick={onExit}>
          {t('annotate.exit')}
        </button>
        <button
          type="button"
          disabled={totalReady === 0 || finishing}
          className="rounded-md bg-foreground px-2.5 py-1 font-medium text-background hover:opacity-90 disabled:opacity-40"
          onClick={() => void finish()}
        >
          {t('annotate.finish')}
        </button>
      </div>
    </div>
  )
}
