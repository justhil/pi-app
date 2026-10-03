import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { collapsedPanes, MAX_PANES, MIN_PANE_PX, type Pane } from './split-layout'
import { PANE_MIME, isSplitDrag, readSessionDrag, setDragLabel, zoneAt, type DropZone } from './split-dnd'
import { PanePreview } from './pane-preview'
import { SessionAttentionDot } from '@renderer/features/workspace/session-attention-dot'
import { focusedPaneSession, splitActions, useSplitStore } from './split-store'

const STRIP_PX = 36

function useRunning(sessionFile: string | undefined): boolean {
  return useUIStore((s) => {
    if (!sessionFile) return false
    const r = s.sessionRuntimeRunning ?? {}
    return Object.entries(r).some(([k, v]) => v && sessionFilesEqual(k, sessionFile))
  })
}

/** Zone under the pointer for a drag over a pane box. */
function dropZoneFor(e: React.DragEvent, box: DOMRect): DropZone {
  const f = (e.clientX - box.left) / box.width
  const moving = e.dataTransfer.types.includes(PANE_MIME)
  let z = zoneAt(f)
  if (moving && z === 'center') z = f < 0.5 ? 'left' : 'right'
  if (!moving && z !== 'center' && useSplitStore.getState().panes.length >= MAX_PANES) z = 'center'
  return z
}

function applyDrop(e: React.DragEvent, z: DropZone, pane: Pane | null, index: number): void {
  const movingId = e.dataTransfer.getData(PANE_MIME)
  if (movingId) {
    const panes = useSplitStore.getState().panes
    const from = panes.findIndex((p) => p.id === movingId)
    let to = z === 'left' ? index : index + 1
    if (from < to) to -= 1
    splitActions.move(movingId, to)
    return
  }
  const session = readSessionDrag(e)
  if (!session) return
  if (z === 'center' && pane) splitActions.replace(pane.id, session)
  else splitActions.open(session, { anchorId: pane?.id, side: z === 'left' ? 'left' : 'right' })
}

/**
 * Wraps a pane: always accepts session / pane drops (the zone is computed from the drop
 * point, so a quick drag works), and highlights the target zone while dragging over it.
 */
function DropTarget({ pane, index, className, style, children, boxRef, ...rest }: { pane: Pane | null; index: number; className?: string; style?: React.CSSProperties; children: ReactNode; boxRef?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement> & { [key: `data-${string}`]: unknown }) {
  const [zone, setZone] = useState<DropZone | null>(null)
  return (
    <div
      {...rest}
      ref={boxRef}
      className={className}
      style={style}
      onDragOver={(e) => {
        if (!isSplitDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(PANE_MIME) ? 'move' : 'copy'
        const z = dropZoneFor(e, e.currentTarget.getBoundingClientRect())
        if (z !== zone) setZone(z)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null)
      }}
      onDrop={(e) => {
        if (!isSplitDrag(e)) return
        e.preventDefault()
        setZone(null)
        applyDrop(e, dropZoneFor(e, e.currentTarget.getBoundingClientRect()), pane, index)
      }}
    >
      {children}
      {zone ? (
        <div
          className={cn(
            'pointer-events-none absolute inset-y-2 z-[60] rounded-lg border-2 border-primary/50 bg-primary/[0.07]',
            zone === 'left' ? 'left-2 right-1/2' : zone === 'right' ? 'left-1/2 right-2' : 'inset-x-2',
          )}
        />
      ) : null}
    </div>
  )
}

function PaneHeader({ pane, index, active }: { pane: Pane; index: number; active: boolean }) {
  const { t } = useTranslation()
  const liveTitle = useUIStore((s) => (active ? focusedPaneSession()?.title || s.sessions.find((x) => x.sessionId === s.currentSessionId)?.title : undefined))
  const title = (active ? liveTitle : pane.session?.title) || (pane.session ? t('common:split.untitled') : t('common:split.newPane'))
  const running = useRunning(pane.session?.sessionFile)
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PANE_MIME, pane.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragLabel(e, title)
      }}
      className={cn('split-pane-header group/pane flex h-8 shrink-0 cursor-grab items-center gap-1.5 border-b px-3 text-[12px] active:cursor-grabbing', active ? 'border-primary/30 text-foreground' : 'border-border/40 text-foreground-tertiary')}
    >
      {running ? <SessionAttentionDot attention="working" className="shrink-0" title={t('common:app.status.running')} /> : null}
      <button type="button" className="min-w-0 flex-1 truncate text-left outline-none focus-visible:underline" aria-current={active ? 'true' : undefined} onClick={() => splitActions.focus(pane.id)} title={title}>
        <span className="sr-only">{t('common:split.pane', { n: index + 1 })} </span>
        {title}
      </button>
      <button
        type="button"
        aria-label={t('common:split.close')}
        title={t('common:split.closeHint')}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-[var(--bg-hover)] focus-visible:opacity-100 group-hover/pane:opacity-70"
        onClick={(e) => {
          e.stopPropagation()
          splitActions.close(pane.id)
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function PreviewFor({ pane }: { pane: Pane }) {
  const running = useRunning(pane.session?.sessionFile)
  return <PanePreview sessionFile={pane.session?.sessionFile ?? null} running={running} />
}

function CollapsedStrip({ pane }: { pane: Pane }) {
  const { t } = useTranslation()
  const running = useRunning(pane.session?.sessionFile)
  const title = pane.session?.title || t('common:split.newPane')
  return (
    <button
      type="button"
      onClick={() => splitActions.focus(pane.id)}
      title={title}
      aria-label={title}
      className="flex h-full w-full flex-col items-center gap-2 border-r border-border/40 py-3 text-[11px] text-foreground-tertiary hover:bg-[var(--bg-hover)] hover:text-foreground"
    >
      {running ? <SessionAttentionDot attention="working" title={t('common:app.status.running')} /> : null}
      <span className="[writing-mode:vertical-rl] max-h-[60%] truncate">{title}</span>
    </button>
  )
}

/**
 * Centre area split into session panes. The active pane hosts `children` (the real
 * timeline + composer of the focused session); others show read-only previews and
 * become active on click. With one pane this renders `children` as before.
 */
export function SplitView({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const layout = useSplitStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const paneEls = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
    // The root element changes between single and split mode.
  }, [layout.panes.length > 1])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = window.piDesktop?.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (!mod) return
      if (e.key === '\\' && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        splitActions.open(null)
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        splitActions.step(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (layout.panes.length <= 1) {
    return (
      <DropTarget pane={layout.panes[0] ?? null} index={0} boxRef={rootRef} className="relative h-full min-w-0">
        {children}
      </DropTarget>
    )
  }

  const collapsed = collapsedPanes(layout, width, STRIP_PX)
  const startResize = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    const left = paneEls.current.get(layout.panes[i].id)
    const right = paneEls.current.get(layout.panes[i + 1].id)
    if (!left || !right) return
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const lr = left.getBoundingClientRect()
    const total = lr.width + right.getBoundingClientRect().width
    const move = (ev: PointerEvent) => splitActions.resize(i, (ev.clientX - lr.left) / total, MIN_PANE_PX / Math.max(1, width))
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <div ref={rootRef} className="split-view flex h-full min-w-0" role="group" aria-label={t('common:split.label')}>
      {layout.panes.map((pane, i) => {
        const active = pane.id === layout.activePaneId
        const isCollapsed = collapsed.has(pane.id)
        const nextVisible = i < layout.panes.length - 1 && !isCollapsed && !collapsed.has(layout.panes[i + 1].id)
        return (
          <div key={pane.id} className="contents">
            <DropTarget
              pane={pane}
              index={i}
              boxRef={(el: HTMLDivElement | null) => {
                if (el) paneEls.current.set(pane.id, el)
                else paneEls.current.delete(pane.id)
              }}
              data-split-pane={pane.id}
              data-active={active || undefined}
              className={cn('split-pane relative flex h-full min-w-0 flex-col', !active && !isCollapsed && 'bg-[var(--bg-base)]')}
              style={isCollapsed ? { flex: `0 0 ${STRIP_PX}px` } : { flex: `${layout.sizes[i]} 1 0`, minWidth: Math.min(MIN_PANE_PX, width) }}
            >
              {isCollapsed ? (
                <CollapsedStrip pane={pane} />
              ) : (
                <>
                  <PaneHeader pane={pane} index={i} active={active} />
                  <div
                    className={cn('relative min-h-0 flex-1', !active && 'cursor-pointer')}
                    onMouseDownCapture={() => !active && splitActions.focus(pane.id)}
                  >
                    {active ? children : <PreviewFor pane={pane} />}
                  </div>
                </>
              )}
            </DropTarget>
            {nextVisible ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('common:split.resize')}
                title={t('common:split.resizeHint')}
                className="split-handle group/handle relative z-10 w-px shrink-0 cursor-col-resize bg-border/60"
                onPointerDown={startResize(i)}
                onDoubleClick={() => splitActions.equalize()}
              >
                <span className="absolute inset-y-0 -left-1 -right-1 group-hover/handle:bg-primary/20" />
              </div>
            ) : i < layout.panes.length - 1 ? (
              <div className="w-px shrink-0 bg-border/60" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
