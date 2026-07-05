import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'
import { RenamePromptDialog } from './rename-prompt-dialog'

type MenuState = { x: number; y: number; path: string; label: string } | null
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
        toast.success('已删除')
        onListChange()
      } else toast.error('删除失败')
    } catch (e) {
      toast.error('删除失败')
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
                重命名
              </button>
              <button
                type="button"
                className={`${itemClass} text-red-600 dark:text-red-400 hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void runDelete(menu.path, menu.label)
                }}
              >
                删除
              </button>
            </div>,
            document.body,
          )
        : null}
      <RenamePromptDialog
        open={!!renameState}
        title="重命名临时对话"
        defaultValue={renameState?.label ?? ''}
        onConfirm={submitRename}
        onCancel={() => setRenameState(null)}
      />
    </>
  )
}