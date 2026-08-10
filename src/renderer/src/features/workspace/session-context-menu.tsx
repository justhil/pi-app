import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from '@renderer/components/icons'
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
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
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
  const { t } = useTranslation()
  const [renameTarget, setRenameTarget] = useState<SessionMenuTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SessionMenuTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  useDismissContextMenu(!!menu, ref, onClose)

  const refreshList = () => onSessionsChange()

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
        refreshList()
        setRenameTarget(null)
      } else toast.error(r?.error || t('common:sidebar.renameFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  const runDelete = (target: SessionMenuTarget) => {
    if (!target.sessionFile) {
      toast.error(t('common:sidebar.deleteMissingFile'))
      onClose()
      return
    }
    setDeleteTarget(target)
    onClose()
  }

  const confirmDelete = async () => {
    const target = deleteTarget
    if (!target || deleting) return
    setDeleting(true)
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
        refreshList()
      } else toast.error(r?.error || t('common:sidebar.deleteFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.deleteFailed'))
    }
    setDeleting(false)
    setDeleteTarget(null)
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
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common:sidebar.deleteSessionTitle')}
        message={t('common:sidebar.deleteSessionConfirm', {
          name: deleteTarget?.title || deleteTarget?.sessionId.slice(0, 8) || '',
        })}
        confirmLabel={t('common:sidebar.delete')}
        destructive
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
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