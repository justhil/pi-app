import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Archive, FolderOpen, ListX } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
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
import { BatchArchiveDialog } from './batch-archive-dialog'

type MenuState = { x: number; y: number; path: string; name: string; hasArchivable: boolean } | null

export function ProjectContextMenuPortal({
  menu,
  onClose,
  onListChange,
}: {
  menu: MenuState
  onClose: () => void
  onListChange: (path?: string) => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [batchState, setBatchState] = useState<{ path: string } | null>(null)
  const [removeState, setRemoveState] = useState<{ path: string; name: string } | null>(null)
  const [removing, setRemoving] = useState(false)

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

  const runRemove = (path: string, name: string) => {
    setRemoveState({ path, name })
    onClose()
  }

  const confirmRemove = async () => {
    const state = removeState
    if (!state || removing) return
    setRemoving(true)
    try {
      const r = await ipcClient.invoke('project.removeRecent', { path: state.path })
      if (!r?.ok) {
        toast.error(r?.error || t('common:sidebar.removeFailed'))
        return
      }
      const store = useUIStore.getState()
      const nextRecent = store.recentProjects.filter((p) => p !== state.path)
      useUIStore.setState({ recentProjects: nextRecent })
      if (store.currentWorkspace === state.path) {
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
      onListChange(state.path)
    } catch (e) {
      toast.error(t('common:sidebar.removeFailed'))
    } finally {
      setRemoving(false)
      setRemoveState(null)
    }
  }

  if (!menu && !batchState && !removeState) return null

  return createPortal(
    <>
      {menu && (
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
          {menu.hasArchivable && (
            <button
              type="button"
              className={contextMenuItemClass}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setBatchState({ path: menu.path })
                onClose()
              }}
            >
              <Archive className="h-3 w-3 shrink-0" strokeWidth={2} />
              {t('common:sidebar.batchArchive')}
            </button>
          )}
          <button
            type="button"
            className={contextMenuDangerItemClass}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              void runRemove(menu.path, menu.name)
            }}
          >
            <ListX className="h-3 w-3 shrink-0" strokeWidth={2} />
            {t('common:sidebar.removeFromList')}
          </button>
        </div>
      )}
      <BatchArchiveDialog
        open={!!batchState}
        workspacePath={batchState?.path ?? ''}
        onCancel={() => setBatchState(null)}
        onDone={(count) => {
          const path = batchState?.path
          setBatchState(null)
          if (count < 0) {
            toast.error(t('common:sidebar.archiveFailed'))
          } else if (count === 0) {
            toast.info(t('common:sidebar.batchArchiveNone'))
          } else {
            toast.success(t('common:sidebar.batchArchived', { count }))
          }
          onListChange(path)
          onClose()
        }}
      />
      <ConfirmDialog
        open={!!removeState}
        title={t('common:sidebar.removeProjectTitle')}
        message={t('common:sidebar.removeProjectConfirm', { name: removeState?.name || '' })}
        confirmLabel={t('common:sidebar.removeFromList')}
        destructive
        busy={removing}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveState(null)}
      />
    </>,
    document.body,
  )
}