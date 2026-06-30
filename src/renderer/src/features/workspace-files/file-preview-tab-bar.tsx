import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { OverlayScrollHostX } from '@renderer/components/ui/overlay-scrollbar'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'
import { fileTreeIcon } from './file-tree-icons'
import { joinWorkspacePath } from './path-utils'
import type { PreviewTab } from './use-file-preview-tabs'

type TabCtx = { x: number; y: number; tab: PreviewTab; abs: string }

export function FilePreviewTabBar({
  workspaceRoot,
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
  trailing,
}: {
  workspaceRoot: string
  tabs: PreviewTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReorder: (fromId: string, toId: string) => void
  trailing: React.ReactNode
}) {
  const { t } = useTranslation('files')
  const [dragId, setDragId] = useState<string | null>(null)
  const [ctx, setCtx] = useState<TabCtx | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)

  useDismissContextMenu(!!ctx, ctxRef, () => setCtx(null))

  useLayoutEffect(() => {
    if (!ctx || !ctxRef.current) return
    const el = ctxRef.current
    const pad = 8
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(pad, Math.min(ctx.x, window.innerWidth - w - pad))
    const top = Math.max(pad, Math.min(ctx.y, window.innerHeight - h - pad))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [ctx])

  if (tabs.length === 0) {
    return (
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <span className="min-w-0 flex-1 text-[11px] text-foreground-secondary/70">{t('chrome.noFile')}</span>
        {trailing}
      </div>
    )
  }

  const onTabMouseDown = (e: ReactMouseEvent, tab: PreviewTab) => {
    if (e.button === 1) {
      e.preventDefault()
      onClose(tab.id)
      return
    }
    if (e.button === 0) {
      setDragId(tab.id)
    }
  }

  const onTabMouseUp = (e: ReactMouseEvent, tab: PreviewTab) => {
    if (e.button !== 0) return
    if (dragId && dragId !== tab.id) {
      onReorder(dragId, tab.id)
    } else if (!dragId || dragId === tab.id) {
      onActivate(tab.id)
    }
    setDragId(null)
  }

  return (
    <>
      <div className="flex h-10 shrink-0 items-stretch gap-0 border-b border-border/50">
        <OverlayScrollHostX
          className="files-tab-strip-host h-10 min-h-10 min-w-0 flex-1"
          innerClassName="gap-1 px-1.5"
          railVisualOnly
        >
          {tabs.map((tab) => {
            const active = tab.id === activeId
            const { Icon, className: iconClass } = fileTreeIcon(tab.name, false)
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                title={tab.rel}
                onMouseDown={(e) => onTabMouseDown(e, tab)}
                onMouseUp={(e) => onTabMouseUp(e, tab)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDragId(null)
                  setCtx({
                    x: e.clientX,
                    y: e.clientY,
                    tab,
                    abs: joinWorkspacePath(workspaceRoot, tab.rel),
                  })
                }}
                className={cn(
                  'files-preview-tab group flex h-8 w-[148px] max-w-[168px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2',
                  active ? 'bg-[var(--bg-active)] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_22%,var(--border-base))]' : 'bg-[var(--bg-1)] text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0 stroke-[1.75]', iconClass)} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{tab.name}</span>
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    className="chrome-icon-btn -mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100"
                    aria-label={t('tabs.close')}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose(tab.id)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            )
          })}
        </OverlayScrollHostX>
        <div className="flex shrink-0 items-center gap-1 border-l border-border/40 px-1.5">{trailing}</div>
      </div>

      {ctx
        ? createPortal(
            <div
              ref={ctxRef}
              className={contextMenuPanelClass}
              style={{ left: ctx.x, top: ctx.y }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                type="button"
                className={contextMenuItemClass}
                onClick={() => {
                  void navigator.clipboard.writeText(ctx.abs)
                  setCtx(null)
                }}
              >
                {t('menu.copyPath')}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}