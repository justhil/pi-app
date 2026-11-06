import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FolderOpen, GitFork, ListX, Pencil, Trash2 } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { projectDisplayNameKey, workspacePathsEqual } from '@shared/workspace-path'
import { toast } from 'sonner'
import {
  contextMenuDangerItemClass,
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from './context-menu-shared'
import { RenamePromptDialog } from './rename-prompt-dialog'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import type { ProjectMenuState, ProjectMenuTarget } from './use-project-context-menu'

function pickTarget(menu: NonNullable<ProjectMenuState>): ProjectMenuTarget {
  return {
    path: menu.path,
    name: menu.name,
    isRepositoryGroup: menu.isRepositoryGroup,
    repositoryPath: menu.repositoryPath,
    isSecondaryWorktree: menu.isSecondaryWorktree,
    groupPaths: menu.groupPaths,
    siblingPaths: menu.siblingPaths,
  }
}

export function ProjectContextMenuPortal({
  menu,
  onClose,
  onListChange,
}: {
  menu: ProjectMenuState
  onClose: () => void
  onListChange: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [renameTarget, setRenameTarget] = useState<ProjectMenuTarget | null>(null)
  const [createWorktreeTarget, setCreateWorktreeTarget] = useState<ProjectMenuTarget | null>(null)
  const [deleteWorktreeTarget, setDeleteWorktreeTarget] = useState<ProjectMenuTarget | null>(null)
  // In-app confirm: a native window.confirm leaves Windows Electron pages untypable (#94).
  const [removeTarget, setRemoveTarget] = useState<ProjectMenuTarget | null>(null)

  useDismissContextMenu(!!menu, ref, onClose)

  const runRevealInExplorer = async (path: string) => {
    try {
      const result = await ipcClient.invoke('shell.showItemInFolder', { path })
      if (!result?.ok) toast.error(t('common:sidebar.revealFailed'))
    } catch {
      toast.error(t('common:sidebar.revealFailed'))
    }
    onClose()
  }

  const submitCreateWorktree = async (branch: string) => {
    const target = createWorktreeTarget
    if (!target) return
    try {
      const r = await ipcClient.invoke('desktop.createGitWorktree', {
        workspaceId: target.repositoryPath || target.path,
        branch,
      })
      if (r?.ok && r.path) {
        toast.success(t('common:sidebar.worktreeCreated'))
        setCreateWorktreeTarget(null)
        onListChange()
        await activateWorkspace(r.path, { preferHome: true })
      } else {
        toast.error(r?.error || t('common:sidebar.worktreeCreateFailed'))
      }
    } catch {
      toast.error(t('common:sidebar.worktreeCreateFailed'))
    }
  }

  const submitRename = async (name: string) => {
    const target = renameTarget
    if (!target) return
    try {
      const r = await ipcClient.invoke('project.rename', {
        path: target.path,
        name,
        isRepositoryGroup: target.isRepositoryGroup,
      })
      if (r?.ok) {
        const key = projectDisplayNameKey(target.path, target.isRepositoryGroup)
        const nextNames = r.projectDisplayNames ?? {
          ...useUIStore.getState().projectDisplayNames,
          ...(key ? { [key]: name.trim() } : {}),
        }
        useUIStore.setState({ projectDisplayNames: nextNames })
        window.dispatchEvent(new CustomEvent('pi-desktop:settings-changed', { detail: { key: 'projectDisplayNames' } }))
        toast.success(t('common:sidebar.renamed'))
        setRenameTarget(null)
      } else {
        toast.error(r?.error || t('common:sidebar.renameFailed'))
      }
    } catch {
      toast.error(t('common:sidebar.renameFailed'))
    }
  }

  const runRemove = async (target: ProjectMenuTarget) => {
    try {
      const r = await ipcClient.invoke('project.removeRecent', {
        path: target.path,
        isRepositoryGroup: target.isRepositoryGroup,
        groupPaths: target.groupPaths,
        siblingPaths: target.siblingPaths,
      })
      if (!r?.ok) {
        toast.error(r?.error || t('common:sidebar.removeFailed'))
        return
      }
      const removedPaths = target.isRepositoryGroup && target.groupPaths?.length ? [target.path, ...target.groupPaths] : [target.path]
      const store = useUIStore.getState()
      const nextRecent = Array.isArray(r.recentProjects)
        ? r.recentProjects
        : store.recentProjects.filter((p) => !removedPaths.some((rem) => workspacePathsEqual(p, rem)))
      useUIStore.setState({ recentProjects: nextRecent })
      if (store.currentWorkspace && removedPaths.some((rem) => workspacePathsEqual(store.currentWorkspace, rem))) {
        const nextPath = (!target.isRepositoryGroup && target.siblingPaths?.[0]) || nextRecent[0]
        if (nextPath) await activateWorkspace(nextPath, { preferHome: true })
        else {
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
    } catch {
      toast.error(t('common:sidebar.removeFailed'))
    }
  }

  const runDeleteWorktree = async (target: ProjectMenuTarget) => {
    try {
      const r = await ipcClient.invoke('desktop.removeGitWorktree', {
        workspaceId: target.repositoryPath || target.path,
        worktreePath: target.path,
      })
      if (!r?.ok) {
        toast.error(r?.error || t('common:sidebar.deleteFailed'))
        return
      }
      const store = useUIStore.getState()
      if (Array.isArray(r.recentProjects)) useUIStore.setState({ recentProjects: r.recentProjects })
      if (store.currentWorkspace && workspacePathsEqual(store.currentWorkspace, target.path)) {
        const nextPath = target.repositoryPath || target.siblingPaths?.[0] || r.currentProject
        if (nextPath) await activateWorkspace(nextPath, { preferHome: true })
      }
      toast.success(t('common:sidebar.deleted'))
      onListChange()
    } catch {
      toast.error(t('common:sidebar.deleteFailed'))
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
                className={contextMenuItemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setCreateWorktreeTarget(pickTarget(menu))
                  onClose()
                }}
              >
                <GitFork className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.newWorktree')}
              </button>
              <button
                type="button"
                className={contextMenuItemClass}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setRenameTarget(pickTarget(menu))
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
                  setRemoveTarget(pickTarget(menu))
                  onClose()
                }}
              >
                <ListX className="h-3 w-3 shrink-0" strokeWidth={2} />
                {t('common:sidebar.removeFromList')}
              </button>
              {menu.isSecondaryWorktree ? (
                <button
                  type="button"
                  className={contextMenuDangerItemClass}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteWorktreeTarget(pickTarget(menu))
                    onClose()
                  }}
                >
                  <Trash2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {t('common:sidebar.deleteWorktree')}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      <RenamePromptDialog
        open={!!createWorktreeTarget}
        title={t('common:sidebar.newWorktreeTitle')}
        defaultValue=""
        placeholder={t('common:sidebar.newWorktreePlaceholder')}
        onConfirm={submitCreateWorktree}
        onCancel={() => setCreateWorktreeTarget(null)}
      />
      <RenamePromptDialog
        open={!!renameTarget}
        title={t('common:sidebar.renameProject')}
        defaultValue={renameTarget?.name ?? ''}
        onConfirm={submitRename}
        onCancel={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        open={!!removeTarget}
        title={t('common:sidebar.removeFromList')}
        message={t('common:sidebar.removeProjectConfirm', { name: removeTarget?.name ?? '' })}
        destructive
        onConfirm={() => {
          const target = removeTarget
          setRemoveTarget(null)
          if (target) void runRemove(target)
        }}
        onCancel={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteWorktreeTarget}
        title={t('common:sidebar.deleteWorktree')}
        message={t('common:sidebar.deleteWorktreeConfirm', { name: deleteWorktreeTarget?.name ?? '' })}
        destructive
        onConfirm={() => {
          const target = deleteWorktreeTarget
          setDeleteWorktreeTarget(null)
          if (target) void runDeleteWorktree(target)
        }}
        onCancel={() => setDeleteWorktreeTarget(null)}
      />
    </>
  )
}
