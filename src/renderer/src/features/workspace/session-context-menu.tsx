
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2, Archive } from '@renderer/components/icons'
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
import { BatchArchiveDialog } from './batch-archive-dialog'
import type { SessionMenuTarget } from './session-context-menu-types'

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
  const [batchTarget, setBatchTarget] = useState<SessionMenuTarget | null>(null)

  useDismissContextMenu(!!menu, ref, onClose)

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

  const runDelete = async (target: SessionMenuTarget) => {
    const defaultTitle = target.title || target.sessionId.slice(0, 8)
    if (!target.sessionFile) {
      toast.error(t('common:sidebar.deleteMissingFile'))
      onClose()
      return
    }
    if (!window.confirm(t('common:sidebar.deleteSessionConfirm', { name: defaultTitle }))) {
      onClose()
      return
    }
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
          useUIStore.getState().setCurrentSession('')
          useUIStore.getState().clearTimeline()
          useUIStore.getState().loadHistoryItems([])
          useUIStore.getState().setHistoryMeta(0, 0, null)
          void ipcClient.invoke('session.setPendingBind', { sessionFile: null })
        }
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
    onClose()
  }

  const runArchive = async (target: SessionMenuTarget) => {
    if (!target.sessionFile) {
      toast.error(t('common:sidebar.archiveMissingFile'))
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('session.archive', {
        sessionFile: target.sessionFile,
        archived: true,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.archived'))
        refreshList(target.workspacePath)
      } else toast.error(r?.error || t('common:sidebar.archiveFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.archiveFailed'))
    }
    onClose()
  }

  const itemClass = contextMenuItemClass
  const renameDefault =
    renameTarget?.title || renameTarget?.sessionId.slice(0, 8) || ''

  return (
    <>
      {menu
        ? createPortal(
            <div
              ref={ref}
              className={contextMenuPanelClass}
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
            >
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
                className={itemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void runArchive(menu.target)
                }}
              >
                <Archive className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.archive')}
              </button>
              <button
                type="button"
                className={itemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setBatchTarget(menu.target)
                  onClose()
                }}
              >
                <Archive className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.batchArchive')}
              </button>
              <button
                type="button"
                className={contextMenuDangerItemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void runDelete(menu.target)
                }}
              >
                <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.delete')}
              </button>
            </div>,
            document.body,
          )
        : null}
      <BatchArchiveDialog
        open={!!batchTarget}
        workspacePath={batchTarget?.workspacePath || ''}
        onCancel={() => setBatchTarget(null)}
        onDone={(count) => {
          const target = batchTarget
          setBatchTarget(null)
          if (count < 0) {
            toast.error(t('common:sidebar.archiveFailed'))
          } else if (count === 0) {
            toast.info(t('common:sidebar.batchArchiveNone'))
          } else {
            toast.success(t('common:sidebar.batchArchived', { count }))
          }
          refreshList(target?.workspacePath)
        }}
      />
      <RenamePromptDialog
        open={!!renameTarget}
        title={t('common:sidebar.renameSession')}
        defaultValue={renameDefault}
        onConfirm={submitRename}
        onCancel={() => setRenameTarget(null)}
      />
    </>
  )

}