import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, MessageSquare, GitFork, ListTree, Loader2 } from '@renderer/components/icons'
import { cloneCurrentSession, forkSessionFromEntry, loadForkCandidates, type ForkSource } from '@renderer/lib/session-fork'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { useUIStore } from '@renderer/stores/ui-store'
import { workspacePathsEqual } from '@shared/workspace-path'
import { contextMenuItemClass, contextMenuPanelClass } from './context-menu-shared'
import type { SessionMenuTarget } from './session-context-menu-types'

/** Most recent user messages offered inline; the rest stay behind "choose another message". */
const RECENT_FORK_POINTS = 5

const sectionLabelClass = 'px-3 pb-1 pt-1.5 text-[11px] font-medium text-foreground-secondary'
const separatorClass = 'my-1 h-px bg-border'

export function SessionForkSubmenu({
  anchor,
  target,
  onDone,
  onSessionsChange,
}: {
  /** Bounding box of the "Fork" row the submenu opens beside. */
  anchor: DOMRect
  target: SessionMenuTarget & { sessionFile: string }
  onDone: () => void
  onSessionsChange: (workspacePath?: string) => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [points, setPoints] = useState<Array<{ entryId: string; text: string }> | null>(null)
  const [position, setPosition] = useState({ left: anchor.right - 4, top: anchor.top - 4 })
  const source: ForkSource = { sessionFile: target.sessionFile, workspacePath: target.workspacePath }

  useEffect(() => {
    let cancelled = false
    setPoints(null)
    void loadForkCandidates({ sessionFile: target.sessionFile, workspacePath: target.workspacePath }).then((list) => {
      if (!cancelled) setPoints(list.slice(-RECENT_FORK_POINTS).reverse())
    })
    return () => {
      cancelled = true
    }
  }, [target.sessionFile, target.workspacePath])

  // Open to the right of the row; flip left / shift up when that would leave the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = anchor.right - 4 + width > window.innerWidth ? Math.max(4, anchor.left - width + 4) : anchor.right - 4
    const top = Math.max(4, Math.min(anchor.top - 4, window.innerHeight - height - 4))
    setPosition((prev) => (prev.left === left && prev.top === top ? prev : { left, top }))
  }, [anchor, points])

  const afterBranch = (ok: boolean) => {
    if (ok) onSessionsChange(target.workspacePath)
  }

  const openFork = (fork: { sessionId: string; sessionFile: string }) => {
    guardSessionSwitch(() => {
      if (workspacePathsEqual(target.workspacePath, useUIStore.getState().currentWorkspace)) {
        void switchSessionInPlace(fork.sessionId, fork.sessionFile)
      } else {
        void activateWorkspace(target.workspacePath, { sessionId: fork.sessionId, sessionFile: fork.sessionFile })
      }
    })
  }

  const run = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    onDone()
    action()
  }

  return (
    <div
      ref={ref}
      className={`${contextMenuPanelClass} w-[260px]`}
      style={position}
      role="menu"
      aria-label={t('common:sidebar.fork')}
      data-session-fork-submenu
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className={contextMenuItemClass}
        onClick={run(() => void cloneCurrentSession(source).then(afterBranch))}
      >
        <Copy className="h-3 w-3 shrink-0" strokeWidth={2} />
        {t('common:sidebar.forkClone')}
      </button>
      <div className={separatorClass} role="separator" />
      <div className={sectionLabelClass}>{t('common:sidebar.forkFromHere')}</div>
      {points === null ? (
        <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-foreground-secondary">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('timeline:treeLoading')}
        </div>
      ) : points.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-foreground-secondary">{t('timeline:forkNoMessages')}</div>
      ) : (
        points.map((point) => {
          const preview = point.text.replace(/\s+/g, ' ').trim()
          return (
            <button
              key={point.entryId}
              type="button"
              role="menuitem"
              className={contextMenuItemClass}
              title={preview}
              onClick={run(() => void forkSessionFromEntry(point.entryId, source).then(afterBranch))}
            >
              <MessageSquare className="h-3 w-3 shrink-0 text-foreground-secondary" strokeWidth={2} />
              <span className="min-w-0 truncate">{preview || t('timeline:forkEmptyMessage')}</span>
            </button>
          )
        })
      )}
      <button
        type="button"
        role="menuitem"
        className={contextMenuItemClass}
        onClick={run(() => {
          window.dispatchEvent(new CustomEvent('pi-desktop:open-fork-selector', { detail: { source } }))
        })}
      >
        <ListTree className="h-3 w-3 shrink-0" strokeWidth={2} />
        {t('common:sidebar.forkChooseMessage')}
      </button>
      {target.forks?.length ? (
        <>
          <div className={separatorClass} role="separator" />
          <div className={sectionLabelClass}>{t('common:sidebar.existingForks')}</div>
          {target.forks.map((fork) => (
            <button
              key={fork.sessionFile}
              type="button"
              role="menuitem"
              className={contextMenuItemClass}
              title={fork.sessionFile}
              onClick={run(() => openFork(fork))}
            >
              <GitFork className="h-3 w-3 shrink-0 text-foreground-secondary" strokeWidth={2} />
              <span className="min-w-0 truncate">{fork.title}</span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  )
}
