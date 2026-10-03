import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatAnnotationsForComposer, type BrowserAnnotation, type ComposerLabels, type ElementDescriptor } from '@shared/browser-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { cropRect, isDrag, placeBeside, rectFromPoints, stackLayout, type Rect } from './annotation-geometry'
import { saveImageAttachment, sendToComposer } from './browser-composer'

interface Item extends BrowserAnnotation {
  rect: Rect
  frame: number
  crop: HTMLCanvasElement
}

interface Pending {
  rect: Rect
  element?: ElementDescriptor
  area?: Rect
}

const EDITOR_SIZE = { width: 280, height: 116 }

/** CSS zoom on <html> (UI scale): pointer/rect values are visual px, inline styles are pre-zoom px. */
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

/**
 * Annotation mode over a frozen screenshot of the page. The page itself is never modified:
 * hit-testing runs in the page's isolated world, highlights and markers are drawn here.
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
  const [hover, setHover] = useState<ElementDescriptor | null>(null)
  const [dragRect, setDragRect] = useState<Rect | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [comment, setComment] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [finishing, setFinishing] = useState(false)
  const pressRef = useRef<{ x: number; y: number } | null>(null)
  const hoverReq = useRef(0)
  const imgRef = useRef<HTMLImageElement>(null)
  /**
   * Wheel pipeline: the frozen image moves at once by the gesture's distance (a transform, no
   * layout); when the gesture goes idle the page scrolls by the sum in one input event (rapid
   * separate events get merged into smooth scrolling and lose distance) and is captured once.
   * The transform resets in the frame the new image appears.
   */
  const wheel = useRef({ unsent: 0, uncaptured: 0, x: 0, y: 0, idle: 0, gen: 0, scrolling: false })

  const local = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const inspect = useCallback(
    (x: number, y: number, deep: boolean) =>
      ipcClient
        .invoke('browser.inspectPoint', { tabId, x, y, deep })
        .then((res: { element?: ElementDescriptor | null }) => res?.element ?? null)
        .catch(() => null),
    [tabId],
  )

  const onPointerMove = (e: ReactPointerEvent) => {
    if (pending || finishing || wheel.current.scrolling) return
    const p = local(e)
    if (pressRef.current) {
      if (isDrag(pressRef.current.x, pressRef.current.y, p.x, p.y)) setDragRect(rectFromPoints(pressRef.current.x, pressRef.current.y, p.x, p.y))
      return
    }
    const req = ++hoverReq.current
    requestAnimationFrame(() => {
      if (req !== hoverReq.current) return
      void inspect(p.x, p.y, false).then((el) => {
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
    setDragRect(null)
    if (isDrag(start.x, start.y, p.x, p.y)) {
      const area = rectFromPoints(start.x, start.y, p.x, p.y)
      setPending({ rect: area, area })
    } else {
      const element = await inspect(p.x, p.y, true)
      if (element) setPending({ rect: element.rect, element })
    }
    setHover(null)
    setComment('')
  }

  const setShift = (px: number) => {
    if (imgRef.current) imgRef.current.style.transform = px ? `translate3d(0, ${-px / uiZoom()}px, 0)` : ''
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
    const res = (await ipcClient.invoke('browser.capture', { tabId }).catch(() => null)) as { dataUrl?: string | null } | null
    if (gen !== w.gen) return
    if (res?.dataUrl) {
      // Decode before swapping, so the swap is one paint, not a stall.
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

  // Wheel scrolls the real page (coalesced per frame) while the frozen image moves at once;
  // the frame is re-frozen once the gesture ends. Earlier annotations keep their crops.
  const onWheel = (e: React.WheelEvent) => {
    if (pending || finishing) return
    const p = local(e)
    const w = wheel.current
    const delta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * p.y : e.deltaY
    // A new gesture while the previous one is still being applied: it continues from there.
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
      ctx.strokeRect(pending.rect.x * scale - c.x, pending.rect.y * scale - c.y, pending.rect.width * scale, pending.rect.height * scale)
    }
    setItems((prev) => [
      ...prev,
      { index: prev.length + 1, comment, element: pending.element, area: pending.area, rect: pending.rect, frame, crop: canvas },
    ])
    setPending(null)
    setComment('')
  }

  const finish = async () => {
    if (items.length === 0) return
    setFinishing(true)
    try {
      const layout = stackLayout(items.map((i) => ({ width: i.crop.width, height: i.crop.height })))
      const canvas = document.createElement('canvas')
      canvas.width = layout.width
      canvas.height = layout.height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        items.forEach((item, i) => {
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
      sendToComposer({ text: formatAnnotationsForComposer(page, items, labels), files: [file] })
      onExit()
    } catch (error) {
      console.error('[browser] annotations export failed:', error)
      toast.error(t('annotate.exportFailed'))
      setFinishing(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pending) {
        e.preventDefault()
        e.stopPropagation()
        setPending(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending])

  useEffect(() => () => {
    const w = wheel.current
    window.clearTimeout(w.idle)
    w.gen++
  }, [])

  const rootRect = rootRef.current?.getBoundingClientRect()
  const editorPos = pending && rootRect
    ? placeBeside(pending.rect, { width: EDITOR_SIZE.width * uiZoom(), height: EDITOR_SIZE.height * uiZoom() }, { width: rootRect.width, height: rootRect.height })
    : null
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

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
      <img ref={imgRef} src={snapshot} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full will-change-transform" />

      {hover && !pending && !dragRect ? (
        <div className="pointer-events-none absolute border-2 border-[#3b82f6] bg-[#3b82f6]/10" style={px(hover.rect)}>
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#3b82f6] px-1 text-[10.5px] leading-4 text-white">
            {hover.tag}
            {hover.classes[0] ? `.${hover.classes[0]}` : ''} · {Math.round(hover.rect.width)}×{Math.round(hover.rect.height)}
          </span>
        </div>
      ) : null}

      {dragRect ? <div className="pointer-events-none absolute border-2 border-dashed border-[#ef4444] bg-[#ef4444]/10" style={px(dragRect)} /> : null}

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
            className="absolute z-30 flex flex-col gap-1.5 rounded-lg border border-border/60 bg-popover text-popover-foreground p-2 shadow-lg"
            style={{ left: editorPos.x / uiZoom(), top: editorPos.y / uiZoom(), width: EDITOR_SIZE.width }}
            onPointerDown={stop}
            onPointerUp={stop}
            onPointerMove={stop}
            onWheel={stop}
          >
            <div className="truncate text-[11px] text-foreground-secondary">
              {pending.element ? `<${pending.element.tag}> ${pending.element.name || pending.element.text || ''}` : t('annotate.area')}
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
              className="w-full resize-none rounded-md border border-border/50 bg-transparent px-2 py-1 text-[12px] text-foreground outline-none focus:border-ring"
            />
            <div className="flex items-center justify-end gap-1.5 text-[11px]">
              <span className="mr-auto text-foreground-tertiary">{t('annotate.enterHint')}</span>
              <button type="button" className="rounded px-2 py-0.5 hover:bg-[var(--bg-hover)]" onClick={() => setPending(null)}>
                {t('annotate.cancel')}
              </button>
              <button type="button" className="rounded bg-primary px-2 py-0.5 text-primary-foreground" onClick={() => void commit()}>
                {t('annotate.add')}
              </button>
            </div>
          </div>
        </>
      ) : null}

      <div
        className="absolute inset-x-2 bottom-2 z-30 flex items-center gap-2 rounded-lg border border-border/60 bg-popover text-popover-foreground px-2.5 py-1.5 text-[12px] shadow-md"
        onPointerDown={stop}
        onPointerUp={stop}
        onPointerMove={stop}
        onWheel={stop}
      >
        <span className="min-w-0 flex-1 truncate text-foreground-secondary">
          {items.length > 0 ? t('annotate.count', { count: items.length }) : t('annotate.hint')}
        </span>
        <button type="button" disabled={items.length === 0} className="rounded px-2 py-0.5 hover:bg-[var(--bg-hover)] disabled:opacity-40"
          onClick={() => setItems((prev) => prev.slice(0, -1))}>
          {t('annotate.undo')}
        </button>
        <button type="button" className="rounded px-2 py-0.5 hover:bg-[var(--bg-hover)]" onClick={onExit}>
          {t('annotate.exit')}
        </button>
        <button type="button" disabled={items.length === 0 || finishing}
          className="rounded bg-primary px-2.5 py-0.5 font-medium text-primary-foreground disabled:opacity-40"
          onClick={() => void finish()}>
          {t('annotate.finish')}
        </button>
      </div>
    </div>
  )
}
