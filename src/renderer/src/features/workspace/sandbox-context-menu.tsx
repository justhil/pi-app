import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Archive, Pencil, Trash2 } from '@renderer/components/icons'
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

type MenuState = { x: number; y: number; path: string; label: string; sessionFile?: string } | null
type RenameState = { path: string; label: string } | null

export function SandboxContextMenuPortal({
  menu,
  onClose,
  onListChange,
}: {
  menu: MenuState
  onClose: () => void
  onListChange: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const [renameState, setRenameState] = useState<RenameState>(null)
  const [batchOpen, setBatchOpen] = useState(false)

  useDismissContextMenu(!!menu, ref, onClose)

  const submitRename = async (label: string) => {
    const state = renameState
    if (!state) return
    try {
      const r = await ipcClient.invoke('workspace.sandbox.rename', {
        path: state.path,
        label,
      })
      if (r?.ok) {
        toast.success(t('common:sidebar.renamed'))
        onListChange()
        setRenameState(null)
      } else toast.error(t('common:sidebar.renameFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  const runDelete = async (path: string, label: string) => {
    if (!window.confirm(t('common:sidebar.deleteConfirm', { name: label }))) {
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('workspace.sandbox.delete', { path })
      if (r?.ok) {
        const cur = useUIStore.getState().currentWorkspace
        if (cur === path) {
          useUIStore.getState().setWorkspace(null)
          useUIStore.getState().clearTimeline()
          useUIStore.getState().setCurrentSession('')
          useUIStore.getState().loadHistoryItems([])
          useUIStore.getState().setHistoryMeta(0, 0, null)
        }
        toast.success(t('common:sidebar.deleted'))
        onListChange()
      } else toast.error(t('common:sidebar.deleteFailed'))
    } catch (e) {
      toast.error(t('common:sidebar.deleteFailed'))
    }
    onClose()
  }

  const runArchive = async (state: NonNullable<MenuState>) => {
    const file = state.sessionFile || state.path
    try {
      const r = await ipcClient.invoke('session.archive', { sessionFile: file, archived: true })
      if (r?.ok) {
        toast.success(t('common:sidebar.archived'))
        onListChange()
      } else toast.error(r?.error || t('common:sidebar.archiveFailed'))
    } catch {
      toast.error(t('common:sidebar.archiveFailed'))
    }
    onClose()
  }

  const itemClass = contextMenuItemClass

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
                  setRenameState({ path: menu.path, label: menu.label })
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
                  void runArchive(menu)
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
                  setBatchOpen(true)
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
                  void runDelete(menu.path, menu.label)
                }}
              >
                <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.delete')}
              </button>
            </div>,
            document.body,
          )
        : null}
      <RenamePromptDialog
        open={!!renameState}
        title={t('common:sidebar.renameTempChat')}
        defaultValue={renameState?.label ?? ''}
        onConfirm={submitRename}
        onCancel={() => setRenameState(null)}
      />
      <BatchArchiveDialog
        open={batchOpen}
        workspacePath=""
        sandbox
        onCancel={() => setBatchOpen(false)}
        onDone={(count) => {
          setBatchOpen(false)
          if (count < 0) {
            toast.error(t('common:sidebar.archiveFailed'))
          } else if (count === 0) {
            toast.info(t('common:sidebar.batchArchiveNone'))
          } else {
            toast.success(t('common:sidebar.batchArchived', { count }))
          }
          onListChange()
        }}
      />
    </>
  )
}