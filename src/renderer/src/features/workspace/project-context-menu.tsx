import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FolderOpen, ListX } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { toast } from 'sonner'
import {
  contextMenuDangerItemClass,
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'

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
  // In-app confirm: a native window.confirm leaves Windows Electron pages untypable (#94).
  const [removeTarget, setRemoveTarget] = useState<{ path: string; name: string } | null>(null)

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

  const runRemove = async (path: string) => {
    try {
      const r = await ipcClient.invoke('project.removeRecent', { path })
      if (!r?.ok) {
        toast.error(r?.error || t('common:sidebar.removeFailed'))
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
  }

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
                className={contextMenuItemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void runRevealInExplorer(menu.path)
                }}
              >
                <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.revealInExplorer')}
              </button>
              <button
                type="button"
                className={contextMenuDangerItemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setRemoveTarget({ path: menu.path, name: menu.name })
                  onClose()
                }}
              >
                <ListX className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.removeFromList')}
              </button>
            </div>,
            document.body,
          )
        : null}
      <ConfirmDialog
        open={!!removeTarget}
        title={t('common:sidebar.removeFromList')}
        message={t('common:sidebar.removeProjectConfirm', { name: removeTarget?.name ?? '' })}
        destructive
        onConfirm={() => {
          const target = removeTarget
          setRemoveTarget(null)
          if (target) void runRemove(target.path)
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  )
}