import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'
import { RenamePromptDialog } from './rename-prompt-dialog'
import type { SessionMenuTarget } from './session-context-menu-types'

export type { SessionMenuTarget } from './session-context-menu-types'

type MenuState = { x: number; y: number; target: SessionMenuTarget } | null

export function SessionContextMenuPortal({
  menu,
  onClose,
  onSessionsChange,
}: {
  menu: MenuState
  onClose: () => void
  onSessionsChange: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [renameTarget, setRenameTarget] = useState<SessionMenuTarget | null>(null)

  useDismissContextMenu(!!menu, ref, onClose)

  const refreshList = () => onSessionsChange()

  const submitRename = async (title: string) => {
    const target = renameTarget
    if (!target) return
    if (!target.sessionFile) {
      toast.error('无法重命名：缺少会话文件路径')
      setRenameTarget(null)
      return
    }
    try {
      const r = await ipcClient.invoke('session.rename', {
        sessionId: target.sessionId,
        sessionFile: target.sessionFile,
        title,
      })
      if (r?.ok) {
        toast.success('已重命名')
        refreshList()
        setRenameTarget(null)
      } else toast.error(r?.error || '重命名失败')
    } catch {
      toast.error('重命名失败')
    }
  }

  const runDelete = async (target: SessionMenuTarget) => {
    const defaultTitle = target.title || target.sessionId.slice(0, 8)
    if (!target.sessionFile) {
      toast.error('无法删除：缺少会话文件路径')
      onClose()
      return
    }
    if (!window.confirm(`删除会话「${defaultTitle}」？对应的 pi 会话文件将永久删除。`)) {
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('session.delete', {
        sessionId: target.sessionId,
        sessionFile: target.sessionFile,
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
        toast.success('已删除')
        refreshList()
      } else toast.error(r?.error || '删除失败')
    } catch {
      toast.error('删除失败')
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
                重命名
              </button>
              <button
                type="button"
                className={`${itemClass} text-red-600 dark:text-red-400 hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void runDelete(menu.target)
                }}
              >
                删除
              </button>
            </div>,
            document.body,
          )
        : null}
      <RenamePromptDialog
        open={!!renameTarget}
        title="重命名会话"
        defaultValue={renameDefault}
        onConfirm={submitRename}
        onCancel={() => setRenameTarget(null)}
      />
    </>
  )
}