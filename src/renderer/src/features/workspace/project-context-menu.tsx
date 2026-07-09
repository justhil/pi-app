import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { toast } from 'sonner'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'

type MenuState = { x: number; y: number; path: string; name: string } | null

export function ProjectContextMenuPortal({
  menu,
  onClose,
  onListChange,
}: {
  menu: MenuState
  onClose: () => void
  onListChange: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useDismissContextMenu(!!menu, ref, onClose)

  const runRevealInExplorer = async (path: string) => {
    try {
      const result = await ipcClient.invoke('shell.showItemInFolder', { path })
      if (!result?.ok) {
        toast.error(t('common:sidebar.revealFailed'))
      }
    } catch {
      toast.error(t('common:sidebar.revealFailed'))
    }
    onClose()
  }

  const runRemove = async (path: string, name: string) => {
    if (!window.confirm(t('common:sidebar.removeProjectConfirm', { name }))) {
      onClose()
      return
    }
    try {
      const r = await ipcClient.invoke('project.removeRecent', { path })
      if (!r?.ok) {
        toast.error(r?.error || t('common:sidebar.removeFailed'))
        onClose()
        return
      }
      const store = useUIStore.getState()
      const nextRecent = store.recentProjects.filter((p) => p !== path)
      useUIStore.setState({ recentProjects: nextRecent })
      if (store.currentWorkspace === path) {
        const nextPath = nextRecent[0]
        if (nextPath) {
          await activateWorkspace(nextPath, { preferHome: true })
        } else {
          store.setWorkspace(null)
          store.setCurrentSession(null)
          store.clearTimeline()
          store.setHistoryMeta(0, 0, null)
          store.setSessions([])
          await ipcClient.invoke('settings.set', { key: 'currentProject', value: null }).catch(() => {})
        }
      }
      toast.success(t('common:sidebar.removed'))
      onListChange()
    } catch (e) {
      toast.error(t('common:sidebar.removeFailed'))
    }
    onClose()
  }

  if (!menu) return null

  return createPortal(
    <div
      ref={ref}
      className={contextMenuPanelClass}
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={contextMenuItemClass}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void runRevealInExplorer(menu.path)
        }}
      >
        {t('common:sidebar.revealInExplorer')}
      </button>
      <button
        type="button"
        className={`${contextMenuItemClass} text-red-600 dark:text-red-400 hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void runRemove(menu.path, menu.name)
        }}
      >
        {t('common:sidebar.removeFromList')}
      </button>
    </div>,
    document.body,
  )
}