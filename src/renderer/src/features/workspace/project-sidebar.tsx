import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight, FolderOpen, Inbox, Plus } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { SandboxContextMenuPortal } from './sandbox-context-menu'
import { useSandboxContextMenu } from './use-sandbox-context-menu'
import { SessionContextMenuPortal } from './session-context-menu'
import { useSessionContextMenu } from './use-session-context-menu'
import { ProjectContextMenuPortal } from './project-context-menu'
import { useProjectContextMenu } from './use-project-context-menu'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import {
  diskProjectName,
  isSandboxPath,
  type SandboxEntry,
  type SessionItem,
} from './project-sidebar-types'
import { ProjectDiskRow, ProjectSessionTree, SandboxDialogRow } from './project-sidebar-rows'

export function ProjectSidebar({
  onOpenProject,
  openProjectLabel,
}: {
  onOpenProject: () => void
  openProjectLabel: string
}) {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const recentProjects = useUIStore((s) => s.recentProjects)
  const sessions = useUIStore((s) => s.sessions)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const [sessionsByWorkspace, setSessionsByWorkspace] = useState<Record<string, SessionItem[]>>({})
  const [loadingSessionPaths, setLoadingSessionPaths] = useState<Set<string>>(() => new Set())
  const [sandboxes, setSandboxes] = useState<SandboxEntry[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [sectionOpen, setSectionOpen] = useState(true)

  const refreshSandboxes = useCallback(() => {
    ipcClient
      .invoke('workspace.sandbox.list')
      .then((r) => setSandboxes(r?.sandboxes || []))
      .catch(() => setSandboxes([]))
  }, [])

  const sandboxMenu = useSandboxContextMenu(refreshSandboxes)

  const loadWorkspaceSessions = useCallback(async (workspaceId: string) => {
    if (!workspaceId || isSandboxPath(workspaceId)) return
    setLoadingSessionPaths((previous) => new Set(previous).add(workspaceId))
    try {
      await refreshWorkspaceSessionLists({ workspaceIds: [workspaceId] })
    } finally {
      setLoadingSessionPaths((previous) => {
        const next = new Set(previous)
        next.delete(workspaceId)
        return next
      })
    }
  }, [])

  const refreshSessionsAfterMutation = useCallback(
    (workspacePath?: string) => {
      const targetPath = workspacePath || currentWorkspace
      if (targetPath && !isSandboxPath(targetPath)) {
        void loadWorkspaceSessions(targetPath)
        return
      }
      void refreshWorkspaceSessionLists()
    },
    [currentWorkspace, loadWorkspaceSessions],
  )

  const sessionMenu = useSessionContextMenu(refreshSessionsAfterMutation)
  const projectMenu = useProjectContextMenu(refreshSessionsAfterMutation)

  useEffect(() => {
    const onChanged = () => refreshSandboxes()
    window.addEventListener('pi-desktop:sandboxes-changed', onChanged)
    return () => window.removeEventListener('pi-desktop:sandboxes-changed', onChanged)
  }, [refreshSandboxes])

  useEffect(() => {
    refreshSandboxes()
    ipcClient
      .invoke('settings.get', { key: 'recentProjects' })
      .then((res) => {
        const list = res?.settings?.recentProjects as string[] | undefined
        if (list?.length) {
          const diskOnly = list.filter((p) => !isSandboxPath(p))
          const merged = [...diskOnly]
          if (currentWorkspace && !isSandboxPath(currentWorkspace) && !merged.includes(currentWorkspace)) {
            merged.unshift(currentWorkspace)
          }
          useUIStore.setState({ recentProjects: [...new Set(merged)].slice(0, 16) })
        }
      })
      .catch(() => {})
  }, [refreshSandboxes, currentWorkspace])

  // Current project only on startup / workspace switch — never every recent project.
  useEffect(() => {
    if (!currentWorkspace || isSandboxPath(currentWorkspace)) return
    const frame = requestAnimationFrame(() => {
      setExpandedPaths((previous) => new Set(previous).add(currentWorkspace))
      void loadWorkspaceSessions(currentWorkspace)
    })
    return () => cancelAnimationFrame(frame)
  }, [currentWorkspace, loadWorkspaceSessions])

  useEffect(() => {
    const onWorkspaceSessions = (event: Event) => {
      const { workspaceId, sessions: list } = (event as CustomEvent).detail as {
        workspaceId: string
        sessions: SessionItem[]
      }
      setSessionsByWorkspace((previous) => ({ ...previous, [workspaceId]: list }))
    }
    window.addEventListener('pi-desktop:workspace-sessions', onWorkspaceSessions)
    return () => window.removeEventListener('pi-desktop:workspace-sessions', onWorkspaceSessions)
  }, [])

  const diskPaths = (() => {
    const set = new Set<string>()
    if (currentWorkspace && !isSandboxPath(currentWorkspace)) set.add(currentWorkspace)
    for (const p of recentProjects) {
      if (!isSandboxPath(p)) set.add(p)
    }
    return [...set]
  })()

  const switchDiskProject = async (path: string) => {
    if (path === currentWorkspace && !ephemeralSandboxDraft) return
    try {
      await activateWorkspace(path)
    } catch (e) {
      console.error('[ProjectSidebar] switch failed:', e)
    }
  }

  const handleNewSandboxDialog = () => {
    useUIStore.getState().enterEphemeralSandboxDraft()
    void import('@renderer/lib/composer-run-display').then((m) => m.refreshComposerRunDisplay())
  }

  const openSandboxDialog = async (box: SandboxEntry) => {
    try {
      let sessionId = box.sessionId
      let sessionFile = box.sessionFile
      if (!sessionId || !sessionFile) {
        const listRes = await ipcClient.invoke('session.list', { workspaceId: box.path })
        const latest = ((listRes?.sessions || []) as SessionItem[]).find((s) => s.sessionId && s.sessionFile)
        if (!latest?.sessionFile) {
          refreshSandboxes()
          return
        }
        sessionId = latest.sessionId
        sessionFile = latest.sessionFile
      }
      if (box.path === currentWorkspace && currentSessionId === sessionId && !ephemeralSandboxDraft) return
      await activateWorkspace(box.path, { sessionId, sessionFile })
    } catch (e) {
      console.error('[ProjectSidebar] open sandbox failed:', e)
    }
  }

  const handleNewSessionInProject = async (workspacePath: string) => {
    if (!workspacePath || isSandboxPath(workspacePath)) return
    try {
      if (workspacePath !== currentWorkspace) {
        await activateWorkspace(workspacePath, { preferHome: true })
      } else {
        const store = useUIStore.getState()
        store.clearPendingNewSessionPlaceholder()
        store.setCurrentSession(null)
        store.clearTimeline()
        store.clearFileChanges()
        store.setHistoryMeta(0, 0, null)
        void import('@renderer/lib/composer-run-display').then((m) => m.refreshComposerRunDisplay())
      }
      setExpandedPaths((prev) => new Set(prev).add(workspacePath))
    } catch (e) {
      console.error('New session (home) failed:', e)
    }
  }

  const mergedSessionsByWorkspace = useMemo(() => {
    const next = { ...sessionsByWorkspace }
    if (currentWorkspace && !isSandboxPath(currentWorkspace)) {
      next[currentWorkspace] = sessions
    }
    return next
  }, [sessionsByWorkspace, currentWorkspace, sessions])

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <button
          type="button"
          onClick={() => void handleNewSandboxDialog()}
          title={t('sidebar.tempChat')}
          className="chrome-icon-btn flex h-8 w-8 items-center justify-center rounded-lg"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenProject}
          title={openProjectLabel}
          className="chrome-icon-btn flex h-8 w-8 items-center justify-center rounded-lg"
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col pb-1">
      <div className="border-b border-border/40 px-2 py-2">
        <button
          type="button"
          onClick={onOpenProject}
          className="nav-row row-hover flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border/50 px-3 py-2.5 text-[13px] font-medium text-foreground-secondary hover:text-foreground"
        >
          <FolderOpen className="h-4 w-4 shrink-0" />
          {openProjectLabel}
        </button>
      </div>

      <div className="px-1.5 pt-2">
        <div className="flex items-center gap-1 px-1 pb-1.5">
          <button
            type="button"
            onClick={() => setSectionOpen(!sectionOpen)}
            className="sidebar-section-hit flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5 text-left"
            aria-expanded={sectionOpen}
          >
            <ChevronRight
              className="chevron-expand h-3 w-3 shrink-0 text-foreground-secondary/80"
              data-open={sectionOpen ? 'true' : 'false'}
            />
            <span className="text-[11px] font-medium tracking-wide text-foreground-secondary/75">
              {t('common:sidebar.conversations')}
            </span>
            <span className="text-[10px] tabular-nums text-foreground-secondary/60">{sandboxes.length}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleNewSandboxDialog()}
            title={t('sidebar.newTempChat')}
            className="chrome-icon-btn shrink-0 cursor-pointer rounded-md p-1.5"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <SidebarAnimatedCollapse open={sectionOpen}>
          <div className="px-0.5">
            {ephemeralSandboxDraft && (
              <div className="nav-row-active mb-0.5 flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 py-2">
                <Inbox className="h-4 w-4 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-foreground">{t('sidebar.newChat')}</div>
                  <div className="text-[11px] text-foreground-secondary/80">{t('common:sidebar.firstMsgIsTitle')}</div>
                </div>
              </div>
            )}
            {sandboxes.length === 0 && !ephemeralSandboxDraft ? (
              <p className="px-3 py-2 text-[12px] text-foreground-secondary/80">{t('sidebar.clickToAdd')}</p>
            ) : (
              sandboxes.map((box) => (
                <SandboxDialogRow
                  key={box.path}
                  box={box}
                  active={box.path === currentWorkspace && !ephemeralSandboxDraft}
                  onOpen={() => void openSandboxDialog(box)}
                  onContextMenu={(e) => sandboxMenu.open(e, box.path, box.label)}
                />
              ))
            )}
          </div>
        </SidebarAnimatedCollapse>
      </div>

      <SandboxContextMenuPortal menu={sandboxMenu.menu} onClose={sandboxMenu.close} onListChange={refreshSandboxes} />
      <SessionContextMenuPortal
        menu={sessionMenu.menu}
        onClose={sessionMenu.close}
        onSessionsChange={refreshSessionsAfterMutation}
      />
      <ProjectContextMenuPortal
        menu={projectMenu.menu}
        onClose={projectMenu.close}
        onListChange={refreshSessionsAfterMutation}
      />

      <div className="mt-2 px-1.5">
        <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-foreground-secondary/75">
          {t('common:sidebar.projects')}
        </div>
        {diskPaths.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-foreground-secondary/80">{t('sidebar.openProject')}</p>
        ) : (
          diskPaths.map((path) => {
            const open = expandedPaths.has(path)
            const projectSessions = mergedSessionsByWorkspace[path] || []
            const loading = loadingSessionPaths.has(path) && projectSessions.length === 0
            return (
              <ProjectDiskRow
                key={path}
                path={path}
                name={diskProjectName(path)}
                active={path === currentWorkspace}
                open={open}
                onToggleOpen={() => {
                  const willExpand = !expandedPaths.has(path)
                  setExpandedPaths((previous) => {
                    const next = new Set(previous)
                    if (next.has(path)) next.delete(path)
                    else next.add(path)
                    return next
                  })
                  // Load sessions on expand (lazy); collapse is display-only.
                  if (willExpand && !(path in mergedSessionsByWorkspace)) {
                    void loadWorkspaceSessions(path)
                  }
                }}
                onNewSession={() => void handleNewSessionInProject(path)}
                onProjectContextMenu={(e) => projectMenu.open(e, path, diskProjectName(path))}
                sessionTree={
                  <ProjectSessionTree
                    workspacePath={path}
                    projectSessions={projectSessions}
                    loading={loading}
                    currentWorkspace={currentWorkspace}
                    currentSessionId={currentSessionId}
                    onSessionContextMenu={(e, payload) => sessionMenu.open(e, payload)}
                  />
                }
              />
            )
          })
        )}
      </div>
    </div>
  )
}