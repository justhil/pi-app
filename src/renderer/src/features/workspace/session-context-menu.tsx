import { requestOpenInPane } from '@renderer/features/split/split-dnd'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Copy, FolderOpen, GitFork, Pencil, Play, Trash2, Columns2 } from '@renderer/components/icons'
import { selectSessionAttention } from '@renderer/lib/session-attention'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { workspacePathsEqual } from '@shared/workspace-path'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import {
  contextMenuDangerItemClass,
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'
import { RenamePromptDialog } from './rename-prompt-dialog'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import type { SessionMenuTarget } from './session-context-menu-types'
import { SessionForkSubmenu } from './session-fork-submenu'

export type { SessionMenuTarget } from './session-context-menu-types'

type MenuState = { x: number; y: number; target: SessionMenuTarget } | null

export function SessionContextMenuPortal({
  menu,
  onClose,
  onSessionsChange,
  onSessionRenamed,
  onSessionRemoved,
}: {
  menu: MenuState
  onClose: () => void
  onSessionsChange: (workspacePath?: string) => void
  /** 重命名成功后本地更新侧栏条目标题：避免整列表重拉（重命名不改变列表顺序，重拉只会引起重渲染闪烁） */
  onSessionRenamed?: (payload: { sessionFile: string; title: string; workspacePath: string }) => void
  /** 删除确认后立即从侧栏移除条目：删除 IPC 可能较慢（worker 重建 runtime），不让 UI 干等 */
  onSessionRemoved?: (payload: { sessionFile: string; workspacePath: string }) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const [renameTarget, setRenameTarget] = useState<SessionMenuTarget | null>(null)
  // In-app confirm: a native window.confirm leaves Windows Electron pages untypable (#94).
  const [deleteTarget, setDeleteTarget] = useState<SessionMenuTarget | null>(null)

  // Row box of the "Fork" item while its submenu is open.
  const [forkAnchor, setForkAnchor] = useState<DOMRect | null>(null)

  useDismissContextMenu(!!menu, ref, onClose)
  useEffect(() => setForkAnchor(null), [menu])

  const refreshList = (path?: string) => onSessionsChange(path)

  const submitRename = async (title: string) => {
    const target = renameTarget
    if (!target) return
    if (!target.sessionFile) {
      toast.error(t('common:sidebar.renameMissingFile'))
      setRenameTarget(null)
      return
    }
    try {
      const r = await ipcClient.invoke('session.rename', {
        sessionId: target.sessionId,
        sessionFile: target.sessionFile,
        title,
        workspaceId: target.workspacePath,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.renamed'))
        if (onSessionRenamed) {
          onSessionRenamed({ sessionFile: target.sessionFile, title, workspacePath: target.workspacePath })
        } else {
          refreshList(target.workspacePath)
        }
        setRenameTarget(null)
      } else toast.error(r?.error || t('common:sidebar.renameFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  const requestDelete = (target: SessionMenuTarget) => {
    if (!target.sessionFile) toast.error(t('common:sidebar.deleteMissingFile'))
    else setDeleteTarget(target)
    onClose()
  }

  const runDelete = async (target: SessionMenuTarget) => {
    if (!target.sessionFile) return
    // 确认后立即乐观移除侧栏条目：删除 IPC 要等 worker 重建 runtime，不让 UI 干等；
    // 完成或失败后再以整列表刷新校准。
    onSessionRemoved?.({ sessionFile: target.sessionFile, workspacePath: target.workspacePath })
    try {
      const r = await ipcClient.invoke('session.delete', {
        sessionFile: target.sessionFile,
        workspaceId: target.workspacePath,
      })
      if (r?.ok) {
        const cur = useUIStore.getState().currentSessionId
        if (cur === target.sessionId) {
          useUIStore.setState({
            currentSessionId: '',
            historySessionFile: null,
            historyTotalCount: 0,
            historyLoadedCount: 0,
            timelineItems: [],
            streamingAssistantId: null,
            optimisticPendingUserText: null,
            agentTurnBootstrapping: false,
            pendingTurnStage: null,
          })
          void ipcClient.invoke('session.setPendingBind', { sessionFile: null })
        }
        // Drop the deleted session's per-session state so late events cannot resurrect it.
        const deletedFile = target.sessionFile
        void import('@renderer/stores/session-scope').then((m) => m.removeSessionState(deletedFile))
        toast.success(t('common:sidebar.deleted'))
        refreshList(target.workspacePath)
      } else {
        toast.error(r?.error || t('common:sidebar.deleteFailed'))
        // 失败时也刷新：把乐观移除的条目恢复回来
        refreshList(target.workspacePath)
      }
    } catch (e) {
      toast.error(t('common:sidebar.deleteFailed'))
      refreshList(target.workspacePath)
    }
  }

  const itemClass = contextMenuItemClass
  const renameDefault =
    renameTarget?.title || renameTarget?.sessionId.slice(0, 8) || ''

  return (
    <>
      {menu
        ? createPortal(
            // One wrapper so outside-click dismissal treats the fork submenu as part of the menu.
            <div ref={ref}>
            <div
              className={contextMenuPanelClass}
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerOver={(e) => {
                if (!(e.target as HTMLElement).closest('[data-fork-item]')) setForkAnchor(null)
              }}
            >
              {menu.target.sessionFile &&
              selectSessionAttention(menu.target.sessionFile, useUIStore.getState().sessionAttention) !==
                'working' ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    const currentWorkspace = useUIStore.getState().currentWorkspace
                    if (workspacePathsEqual(menu.target.workspacePath, currentWorkspace)) {
                      void switchSessionInPlace(menu.target.sessionId, menu.target.sessionFile)
                    } else {
                      void activateWorkspace(menu.target.workspacePath, {
                        sessionId: menu.target.sessionId,
                        sessionFile: menu.target.sessionFile,
                      })
                    }
                    onClose()
                  }}
                >
                  <Play className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.continue')}
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    const target = menu.target
                    if (target.sessionFile) {
                      requestOpenInPane({ sessionId: target.sessionId, sessionFile: target.sessionFile, workspace: target.workspacePath, title: target.title })
                    }
                    onClose()
                  }}
                >
                  <Columns2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:split.openInPane')}
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  data-fork-item
                  aria-haspopup="menu"
                  aria-expanded={!!forkAnchor}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerEnter={(e) => setForkAnchor(e.currentTarget.getBoundingClientRect())}
                  onClick={(e) => {
                    e.stopPropagation()
                    setForkAnchor(e.currentTarget.getBoundingClientRect())
                  }}
                >
                  <GitFork className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.fork')}
                  <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-foreground-secondary" strokeWidth={2} />
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void navigator.clipboard.writeText(menu.target.sessionFile || '')
                    toast.success(t('files:toast.copied'))
                    onClose()
                  }}
                >
                  <Copy className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.copySessionPath')}
                </button>
              ) : null}
              {menu.target.sessionFile ? (
                <button
                  type="button"
                  className={itemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void ipcClient.invoke('shell.showItemInFolder', { path: menu.target.sessionFile })
                    onClose()
                  }}
                >
                  <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.openLog')}
                </button>
              ) : null}
              <button
                type="button"
                className={itemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setRenameTarget(menu.target)
                  onClose()
                }}
              >
                <Pencil className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.rename')}
              </button>
              <button
                type="button"
                className={contextMenuDangerItemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  requestDelete(menu.target)
                }}
              >
                <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.delete')}
              </button>
            </div>
            {forkAnchor && menu.target.sessionFile ? (
              <SessionForkSubmenu
                anchor={forkAnchor}
                target={{ ...menu.target, sessionFile: menu.target.sessionFile }}
                onDone={onClose}
                onSessionsChange={refreshList}
              />
            ) : null}
            </div>,
            document.body,
          )
        : null}
      <RenamePromptDialog
        open={!!renameTarget}
        title={t('common:sidebar.renameSession')}
        defaultValue={renameDefault}
        onConfirm={submitRename}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common:sidebar.delete')}
        message={t('common:sidebar.deleteSessionConfirm', {
          name: deleteTarget?.title || deleteTarget?.sessionId.slice(0, 8) || '',
        })}
        destructive
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) void runDelete(target)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}