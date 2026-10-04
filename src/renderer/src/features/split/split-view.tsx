import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'
import { selectSessionAttention, type SessionAttention } from '@renderer/lib/session-attention'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { SessionAttentionDot } from '@renderer/features/workspace/session-attention-dot'
import {
  MAX_PANES,
  handleRects,
  needsFocusMode,
  paneRects,
  presetsFor,
  snapOf,
  type HandleRect,
  type Pane,
  type PaneRect,
  type Preset,
  type Side,
} from './split-layout'
import { PANE_MIME, isSplitDrag, readSessionDrag, setDragLabel, zoneAt, type DropZone } from './split-dnd'
import { PanePreview, paneDigest, usePaneTimeline } from './pane-preview'
import { focusedPaneSession, splitActions, useSplitStore } from './split-store'

const GAP = 6
const TABS_H = 34
/** Below this an inactive pane shows a compact card instead of the message preview. */
const PREVIEW_MIN_W = 380
const PREVIEW_MIN_H = 240
const MIN_ANY_PX = 160

const mod = (e: KeyboardEvent | React.MouseEvent) => (window.piDesktop?.platform === 'darwin' ? e.metaKey : e.ctrlKey)

function useAttention(sessionFile: string | undefined): SessionAttention {
  return useUIStore((s) => {
    if (!sessionFile) return 'idle'
    const a = selectSessionAttention(sessionFile, s.sessionAttention ?? {})
    if (a !== 'idle') return a
    const running = Object.entries(s.sessionRuntimeRunning ?? {}).some(([k, v]) => v && sessionFilesEqual(k, sessionFile))
    return running ? 'working' : 'idle'
  })
}

function useSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [ref])
  return size
}

function timeAgo(ts: number | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!ts) return ''
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 1) return t('common:split.ago.now')
  if (m < 60) return t('common:split.ago.minutes', { count: m })
  const h = Math.round(m / 60)
  if (h < 24) return t('common:split.ago.hours', { count: h })
  return t('common:split.ago.days', { count: Math.round(h / 24) })
}

// ── Drag & drop ─────────────────────────────────────────────────────────────

function zoneFor(e: React.DragEvent, box: DOMRect, pane: Pane | null): DropZone {
  const z = zoneAt((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height)
  const moving = e.dataTransfer.types.includes(PANE_MIME)
  // A new pane needs room for one more; a moved pane only rearranges.
  if (!moving && z !== 'center' && useSplitStore.getState().panes.length >= MAX_PANES) return 'center'
  if (moving && !pane) return 'center'
  return z
}

function applyDrop(e: React.DragEvent, zone: DropZone, pane: Pane | null): void {
  const movingId = e.dataTransfer.getData(PANE_MIME)
  if (movingId) {
    if (pane) splitActions.drop(movingId, pane.id, zone)
    return
  }
  const session = readSessionDrag(e)
  if (!session) return
  if (zone === 'center' && pane) splitActions.replace(pane.id, session)
  else splitActions.open(session, { anchorId: pane?.id, side: zone === 'center' ? 'right' : zone })
}

/** Where the dropped thing will land, drawn over the target pane while dragging. */
function DropPreview({ zone, moving }: { zone: DropZone; moving: boolean }) {
  const { t } = useTranslation()
  const area: Record<DropZone, string> = {
    left: 'inset-y-1.5 left-1.5 right-1/2',
    right: 'inset-y-1.5 left-1/2 right-1.5',
    top: 'inset-x-1.5 top-1.5 bottom-1/2',
    bottom: 'inset-x-1.5 top-1/2 bottom-1.5',
    center: 'inset-1.5',
  }
  return (
    <div className={cn('split-drop-preview pointer-events-none absolute z-[60] flex items-center justify-center rounded-lg', area[zone])}>
      <span className="split-drop-label rounded-md px-2 py-0.5 text-[11.5px]">
        {zone === 'center' ? t(moving ? 'common:split.dropSwap' : 'common:split.dropReplace') : t('common:split.dropSplit')}
      </span>
    </div>
  )
}

function DropTarget({
  pane,
  className,
  style,
  children,
  ...rest
}: { pane: Pane | null; className?: string; style?: CSSProperties; children: ReactNode } & React.HTMLAttributes<HTMLDivElement> & { [key: `data-${string}`]: unknown }) {
  const [drag, setDrag] = useState<{ zone: DropZone; moving: boolean } | null>(null)
  return (
    <div
      {...rest}
      className={className}
      style={style}
      onDragOver={(e) => {
        if (!isSplitDrag(e)) return
        e.preventDefault()
        const moving = e.dataTransfer.types.includes(PANE_MIME)
        e.dataTransfer.dropEffect = moving ? 'move' : 'copy'
        const zone = zoneFor(e, e.currentTarget.getBoundingClientRect(), pane)
        if (zone !== drag?.zone || moving !== drag?.moving) setDrag({ zone, moving })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(null)
      }}
      onDrop={(e) => {
        if (!isSplitDrag(e)) return
        e.preventDefault()
        setDrag(null)
        applyDrop(e, zoneFor(e, e.currentTarget.getBoundingClientRect(), pane), pane)
      }}
    >
      {children}
      {drag ? <DropPreview zone={drag.zone} moving={drag.moving} /> : null}
    </div>
  )
}

// ── Layout menu ─────────────────────────────────────────────────────────────

/** Tiny pictures of each preset, drawn like tmux's layouts. */
const PRESET_SHAPES: Record<Preset, [number, number, number, number][]> = {
  columns: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  rows: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
  'main-left': [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]],
  'main-top': [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]],
  grid: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
}

function Thumb({ cells }: { cells: [number, number, number, number][] }) {
  return (
    <svg viewBox="0 0 40 28" className="h-7 w-10" aria-hidden>
      {cells.map(([x, y, w, h], i) => (
        <rect key={i} x={x * 40 + 1} y={y * 28 + 1} width={w * 40 - 2} height={h * 28 - 2} rx="2.5" className={i === 0 ? 'split-thumb-main' : 'split-thumb-cell'} />
      ))}
    </svg>
  )
}

const SPLIT_ICON: Record<'right' | 'bottom', [number, number, number, number][]> = {
  right: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  bottom: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
}

function SplitGlyph({ side }: { side: 'right' | 'bottom' }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {side === 'right' ? <path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.3" /> : <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.3" />}
    </svg>
  )
}

function LayoutMenu({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const count = useSplitStore((s) => s.panes.length)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])
  const full = count >= MAX_PANES
  return (
    <div ref={ref} role="menu" className="split-menu absolute right-1 top-8 z-[70] w-60 rounded-lg p-1.5" data-split-menu="">
      <div className="px-1.5 pb-1 text-[11px] text-foreground-secondary">{t('common:split.splitThis')}</div>
      <div className="grid grid-cols-3 gap-1">
        {(['right', 'bottom'] as const).map((side) => (
          <button
            key={side}
            type="button"
            role="menuitem"
            disabled={full}
            onClick={() => {
              splitActions.open(null, { anchorId: paneId, side })
              onClose()
            }}
            className="split-menu-item flex flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[11.5px] disabled:opacity-40"
          >
            <Thumb cells={SPLIT_ICON[side]} />
            {t(side === 'right' ? 'common:split.splitRight' : 'common:split.splitDown')}
          </button>
        ))}
      </div>
      {count >= 2 ? (
        <>
          <div className="mt-1.5 px-1.5 pb-1 text-[11px] text-foreground-secondary">{t('common:split.layout')}</div>
          <div className="grid grid-cols-3 gap-1">
            {presetsFor(count).map((p) => (
              <button
                key={p}
                type="button"
                role="menuitem"
                title={t(`common:split.presets.${p}`)}
                aria-label={t(`common:split.presets.${p}`)}
                onClick={() => {
                  splitActions.preset(p)
                  onClose()
                }}
                className="split-menu-item flex flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[11px] text-foreground-secondary"
              >
                <Thumb cells={PRESET_SHAPES[p].slice(0, p === 'grid' ? count : undefined)} />
                {t(`common:split.presets.${p}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              splitActions.equalize()
              onClose()
            }}
            className="split-menu-item mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12px]"
          >
            {t('common:split.equalize')}
          </button>
        </>
      ) : null}
    </div>
  )
}

// ── Pane chrome ─────────────────────────────────────────────────────────────

function paneTitle(pane: Pane, active: boolean, t: (k: string) => string): string {
  const live = active ? focusedPaneSession()?.title : undefined
  return live || pane.session?.title || (pane.session ? t('common:split.untitled') : t('common:split.newPane'))
}

function PaneHeader({ pane, index, active }: { pane: Pane; index: number; active: boolean }) {
  const { t } = useTranslation()
  useUIStore((s) => (active ? s.sessions : null))
  const title = paneTitle(pane, active, t)
  const attention = useAttention(pane.session?.sessionFile)
  const [menu, setMenu] = useState(false)
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PANE_MIME, pane.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragLabel(e, title)
      }}
      className={cn(
        'split-pane-header group/pane relative flex h-9 shrink-0 cursor-grab items-center gap-2 pl-4 pr-1.5 text-[12px] active:cursor-grabbing',
        active ? 'text-foreground' : 'text-foreground-secondary hover:text-foreground',
      )}
    >
      <SessionAttentionDot attention={attention} className="shrink-0" title={t(`common:split.status.${attention}`)} />
      <button type="button" className="min-w-0 flex-1 truncate text-left outline-none focus-visible:underline" aria-current={active ? 'true' : undefined} onClick={() => splitActions.focus(pane.id)} title={title}>
        <span className="sr-only">{t('common:split.pane', { n: index + 1 })} </span>
        {title}
      </button>
      <div className={cn('flex items-center gap-0.5', menu ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover/pane:opacity-100')}>
        <button
          type="button"
          aria-label={t('common:split.layoutMenu')}
          title={t('common:split.layoutMenu')}
          aria-expanded={menu}
          className="split-icon-btn flex h-6 w-6 items-center justify-center rounded-md"
          onClick={(e) => {
            e.stopPropagation()
            setMenu((m) => !m)
          }}
        >
          <SplitGlyph side="right" />
        </button>
        <button
          type="button"
          aria-label={t('common:split.close')}
          title={t('common:split.closeHint')}
          className="split-icon-btn flex h-6 w-6 items-center justify-center rounded-md"
          onClick={(e) => {
            e.stopPropagation()
            splitActions.close(pane.id)
          }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {menu ? <LayoutMenu paneId={pane.id} onClose={() => setMenu(false)} /> : null}
    </div>
  )
}

/** A small inactive pane: status, the latest question and the reply so far — no composer. */
function PaneCard({ pane, compact }: { pane: Pane; compact: boolean }) {
  const { t } = useTranslation()
  const attention = useAttention(pane.session?.sessionFile)
  const meta = useUIStore((s) => (pane.session ? s.sessions.find((x) => sessionFilesEqual(x.sessionFile, pane.session!.sessionFile)) : undefined))
  const items = usePaneTimeline(pane.session?.sessionFile ?? null)
  const d = paneDigest(items)
  if (!pane.session) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-foreground-tertiary" data-pane-card="empty">
        {t('common:split.emptyPane')}
      </div>
    )
  }
  const status =
    attention === 'working'
      ? d.toolLive
        ? t('common:split.card.usingTools', { count: d.tools })
        : t('common:split.replying')
      : attention === 'needs-you'
        ? t('common:split.status.needs-you')
        : attention === 'done'
          ? t('common:split.status.done')
          : timeAgo(meta?.updatedAt, t)
  return (
    <div className="split-card flex h-full min-h-0 flex-col gap-2 px-4 pb-3 pt-1" data-pane-card="">
      <div className={cn('text-[11.5px]', attention === 'needs-you' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground-secondary')}>{status}</div>
      {d.lastUser ? (
        <div className={cn('rounded-lg bg-[var(--message-user-bg)] px-2.5 py-1.5 text-[12px] leading-[1.5] text-foreground', compact ? 'line-clamp-1' : 'line-clamp-2')}>{d.lastUser}</div>
      ) : null}
      {d.lastReply ? (
        <div className={cn('min-h-0 overflow-hidden text-[12px] leading-[1.55] text-foreground-secondary', compact ? 'line-clamp-2' : 'line-clamp-[8]')}>{d.lastReply}</div>
      ) : !d.lastUser ? (
        <div className="text-[12px] text-foreground-secondary">{t('common:split.clickToLoad')}</div>
      ) : null}
      <div className="mt-auto flex items-center gap-2 text-[11px] tabular-nums text-foreground-secondary">
        {meta?.modelId ? <span className="truncate font-mono">{meta.modelId}</span> : null}
        {d.turns ? <span className="shrink-0">{t('common:split.card.turns', { count: d.turns })}</span> : null}
      </div>
    </div>
  )
}

function PaneBody({ pane, active, rect, children }: { pane: Pane; active: boolean; rect: PaneRect; children: ReactNode }) {
  const attention = useAttention(pane.session?.sessionFile)
  if (active) return <>{children}</>
  const roomy = rect.w >= PREVIEW_MIN_W && rect.h >= PREVIEW_MIN_H
  return roomy ? <PanePreview sessionFile={pane.session?.sessionFile ?? null} running={attention === 'working'} /> : <PaneCard pane={pane} compact={rect.h < 170} />
}

// ── Resize handles ──────────────────────────────────────────────────────────

function Handle({ handle, rootRef, onDrag }: { handle: HandleRect; rootRef: React.RefObject<HTMLDivElement | null>; onDrag: (ratio: number | null) => void }) {
  const { t } = useTranslation()
  const row = handle.dir === 'row'
  return (
    <div
      role="separator"
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-label={t('common:split.resize')}
      title={t('common:split.resizeHint')}
      data-split-handle={handle.splitId}
      className={cn('split-handle group/handle absolute z-20', row ? 'cursor-col-resize' : 'cursor-row-resize')}
      style={{ left: handle.x, top: handle.y, width: handle.w, height: handle.h }}
      onDoubleClick={() => splitActions.equalize()}
      onPointerDown={(e) => {
        e.preventDefault()
        const root = rootRef.current?.getBoundingClientRect()
        if (!root) return
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const span = (row ? handle.area.w : handle.area.h) - GAP
        const move = (ev: PointerEvent) => {
          const pos = row ? ev.clientX - root.left - handle.area.x : ev.clientY - root.top - handle.area.y
          const ratio = (pos - GAP / 2) / Math.max(1, span)
          splitActions.resize(handle.splitId, ratio, MIN_ANY_PX / Math.max(1, span))
          const r = useSplitStore.getState()
          onDrag(handleRects(r.root, root.width, root.height, GAP).find((h) => h.splitId === handle.splitId)?.ratio ?? ratio)
        }
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          document.body.style.cursor = ''
          onDrag(null)
        }
        document.body.style.cursor = row ? 'col-resize' : 'row-resize'
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        onDrag(handle.ratio)
      }}
    >
      <span className={cn('split-handle-line absolute rounded-full', row ? 'inset-y-6 left-1/2 w-px -translate-x-1/2' : 'inset-x-6 top-1/2 h-px -translate-y-1/2')} />
    </div>
  )
}

const SNAP_LABEL: Record<string, string> = { [String(1 / 3)]: '1/3', [String(1 / 2)]: '1/2', [String(2 / 3)]: '2/3' }

function ResizeGuide({ handle, ratio }: { handle: HandleRect; ratio: number }) {
  const snap = snapOf(ratio)
  const row = handle.dir === 'row'
  return (
    <div
      className={cn('split-guide pointer-events-none absolute z-30', snap !== undefined && 'split-guide--snapped')}
      style={row ? { left: handle.x + GAP / 2, top: handle.area.y, height: handle.area.h, width: 1 } : { top: handle.y + GAP / 2, left: handle.area.x, width: handle.area.w, height: 1 }}
    >
      <span className={cn('split-guide-label absolute rounded-md px-1.5 py-0.5 text-[11px] tabular-nums', row ? 'left-2 top-1/2 -translate-y-1/2' : 'left-1/2 top-2 -translate-x-1/2')}>
        {snap !== undefined ? SNAP_LABEL[String(snap)] : `${Math.round(ratio * 100)}%`}
      </span>
    </div>
  )
}

// ── Split view ──────────────────────────────────────────────────────────────

function FocusTabs({ panes, activeId }: { panes: Pane[]; activeId: string }) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState(false)
  return (
    <div className="split-tabs absolute inset-x-0 top-0 flex items-center gap-1 px-2" style={{ height: TABS_H }}>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" role="tablist" aria-label={t('common:split.label')}>
        {panes.map((p, i) => (
          <FocusTab key={p.id} pane={p} index={i} active={p.id === activeId} />
        ))}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label={t('common:split.layoutMenu')}
          title={t('common:split.focusHint')}
          aria-expanded={menu}
          className="split-icon-btn flex h-7 w-7 items-center justify-center rounded-md"
          onClick={() => setMenu((m) => !m)}
        >
          <SplitGlyph side="right" />
        </button>
        {menu ? <LayoutMenu paneId={activeId} onClose={() => setMenu(false)} /> : null}
      </div>
    </div>
  )
}

function FocusTab({ pane, index, active }: { pane: Pane; index: number; active: boolean }) {
  const { t } = useTranslation()
  const attention = useAttention(pane.session?.sessionFile)
  const title = paneTitle(pane, active, t)
  return (
    <div className={cn('split-tab group/tab flex h-7 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-md pl-2.5 pr-1 text-[12px]', active && 'split-tab--active')} data-split-pane={pane.id} data-active={active || undefined}>
      <SessionAttentionDot attention={attention} className="shrink-0" />
      <button type="button" role="tab" aria-selected={active} className="min-w-0 flex-1 truncate text-left" onClick={() => splitActions.focus(pane.id)} title={title}>
        <span className="sr-only">{t('common:split.pane', { n: index + 1 })} </span>
        {title}
      </button>
      <button
        type="button"
        aria-label={t('common:split.close')}
        className="split-icon-btn flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 group-hover/tab:opacity-100"
        onClick={() => splitActions.close(pane.id)}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/**
 * Centre area split into session panes, tmux style. Panes are positioned absolutely from the
 * layout tree, keyed by pane id, so rearranging never remounts the active pane's timeline.
 * The active pane hosts `children` (the real timeline + composer); others show a preview or,
 * when small, a status card. Too little room for the active pane switches to tabs.
 */
export function SplitView({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const layout = useSplitStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const { w, h } = useSize(rootRef)
  const [resizing, setResizing] = useState<{ splitId: string; ratio: number } | null>(null)

  useEffect(() => splitActions.setViewport(w, h), [w, h])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mod(e)) return
      if ((e.code === 'Backslash' || e.key === '\\') && !e.altKey) {
        e.preventDefault()
        splitActions.open(null, { side: e.shiftKey ? 'bottom' : 'right' })
      } else if (e.altKey && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const dir: Record<string, Side> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }
        splitActions.focusDir(dir[e.key])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const multi = layout.panes.length > 1
  const focus = multi && needsFocusMode(layout, w, h)
  const rects = new Map((multi && !focus ? paneRects(layout.root, w, h, GAP) : []).map((r) => [r.id, r]))
  const handles = multi && !focus ? handleRects(layout.root, w, h, GAP) : []
  // Stable DOM order: moving panes in the tree only changes their position, never their node.
  const ordered = [...layout.panes].sort((a, b) => a.id.localeCompare(b.id))

  return (
    <div ref={rootRef} className={cn('relative h-full min-w-0', multi && 'split-view')} role={multi ? 'group' : undefined} aria-label={multi ? t('common:split.label') : undefined}>
      {!multi ? (
        <DropTarget pane={layout.panes[0] ?? null} className="relative h-full min-w-0">
          {children}
        </DropTarget>
      ) : (
        <>
          {focus ? <FocusTabs panes={layout.panes} activeId={layout.activePaneId} /> : null}
          {ordered.map((pane) => {
            const active = pane.id === layout.activePaneId
            if (focus && !active) return null
            const rect = focus ? { id: pane.id, x: 0, y: TABS_H, w, h: Math.max(0, h - TABS_H) } : rects.get(pane.id)
            if (!rect) return null
            const index = layout.panes.findIndex((p) => p.id === pane.id)
            return (
              <DropTarget
                key={pane.id}
                pane={pane}
                data-split-pane={focus ? undefined : pane.id}
                data-active={!focus && active ? true : undefined}
                className={cn('split-pane split-pane--card absolute flex min-w-0 flex-col', active && 'split-pane--active', !resizing && 'split-pane--animate')}
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              >
                {focus ? null : <PaneHeader pane={pane} index={index} active={active} />}
                <div className={cn('relative min-h-0 flex-1', !active && 'cursor-pointer')} onMouseDownCapture={() => !active && splitActions.focus(pane.id)}>
                  <PaneBody pane={pane} active={active} rect={rect}>
                    {children}
                  </PaneBody>
                </div>
              </DropTarget>
            )
          })}
          {handles.map((hd) => (
            <Handle key={hd.splitId} handle={hd} rootRef={rootRef} onDrag={(ratio) => setResizing(ratio === null ? null : { splitId: hd.splitId, ratio })} />
          ))}
          {resizing
            ? (() => {
                const hd = handles.find((x) => x.splitId === resizing.splitId)
                return hd ? <ResizeGuide handle={hd} ratio={hd.ratio} /> : null
              })()
            : null}
        </>
      )}
    </div>
  )
}
