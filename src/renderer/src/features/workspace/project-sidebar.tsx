import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { ChevronDown, ChevronRight, FolderOpen, Plus, Folder, Inbox } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { SandboxContextMenuPortal } from './sandbox-context-menu'
import { useSandboxContextMenu } from './use-sandbox-context-menu'
import { SessionContextMenuPortal } from './session-context-menu'
import { useSessionContextMenu } from './use-session-context-menu'
import { ProjectContextMenuPortal } from './project-context-menu'
import { useProjectContextMenu } from './use-project-context-menu'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'

type SandboxEntry = {
  id: string
  path: string
  label: string
  createdAt: number
  kind: 'sandbox'
  sessionId?: string
  sessionFile?: string
}

type SessionItem = {
  sessionId: string
  sessionFile?: string
  title: string
  updatedAt: number
  messageCount?: number
  modelId: string
}

function diskProjectName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

function isSandboxPath(path: string) {
  return path.replace(/\\/g, '/').includes('sandbox-workspaces/')
}

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
  const setWorkspace = useUIStore((s) => s.setWorkspace)
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

  const refreshSessionsForWorkspace = useCallback(async (workspaceId: string) => {
    if (!workspaceId || isSandboxPath(workspaceId)) return
    setLoadingSessionPaths((prev) => new Set(prev).add(workspaceId))
    try {
      const listRes = await ipcClient.invoke('session.list', { workspaceId })
      const list = (listRes?.sessions || []) as SessionItem[]
      setSessionsByWorkspace((prev) => ({ ...prev, [workspaceId]: list }))
      if (useUIStore.getState().currentWorkspace === workspaceId) {
        useUIStore.getState().setSessions(list)
      }
    } catch (e) {
      console.error('[ProjectSidebar] session list failed:', workspaceId, e)
      setSessionsByWorkspace((prev) => ({ ...prev, [workspaceId]: [] }))
      if (useUIStore.getState().currentWorkspace === workspaceId) {
        useUIStore.getState().setSessions([])
      }
    } finally {
      setLoadingSessionPaths((prev) => {
        const next = new Set(prev)
        next.delete(workspaceId)
        return next
      })
    }
  }, [])

  const refreshAllSessionLists = useCallback(() => refreshWorkspaceSessionLists(), [])

  const sessionMenu = useSessionContextMenu(refreshAllSessionLists)
  const projectMenu = useProjectContextMenu(refreshAllSessionLists)
  useEffect(() => {
    const onChanged = () => refreshSandboxes()
    window.addEventListener('pi-desktop:sandboxes-changed', onChanged)
    return () => window.removeEventListener('pi-desktop:sandboxes-changed', onChanged)
  }, [refreshSandboxes])

  useEffect(() => {
    refreshSandboxes()
    ipcClient.invoke('settings.get', { key: 'recentProjects' }).then((res) => {
      const list = res?.settings?.recentProjects as string[] | undefined
      if (list?.length) {
        const diskOnly = list.filter((p) => !isSandboxPath(p))
        const merged = [...diskOnly]
        if (currentWorkspace && !isSandboxPath(currentWorkspace) && !merged.includes(currentWorkspace)) {
          merged.unshift(currentWorkspace)
        }
        useUIStore.setState({ recentProjects: [...new Set(merged)].slice(0, 16) })
      }
    }).catch(() => {})
  }, [refreshSandboxes, currentWorkspace])

  useEffect(() => {
    void refreshAllSessionLists()
  }, [currentWorkspace, recentProjects, refreshAllSessionLists])

  useEffect(() => {
    const onSessionsChanged = () => void refreshAllSessionLists()
    window.addEventListener('pi-desktop:sessions-changed', onSessionsChanged)
    return () => window.removeEventListener('pi-desktop:sessions-changed', onSessionsChanged)
  }, [refreshAllSessionLists])

  useEffect(() => {
    const onWs = (e: Event) => {
      const { workspaceId, sessions } = (e as CustomEvent).detail as {
        workspaceId: string
        sessions: SessionItem[]
      }
      setSessionsByWorkspace((prev) => ({ ...prev, [workspaceId]: sessions }))
    }
    window.addEventListener('pi-desktop:workspace-sessions', onWs)
    return () => window.removeEventListener('pi-desktop:workspace-sessions', onWs)
  }, [])

  useEffect(() => {
    if (currentWorkspace && !isSandboxPath(currentWorkspace)) {
      setExpandedPaths((prev) => new Set(prev).add(currentWorkspace))
    }
  }, [currentWorkspace])

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
        // Same project: go home (clear current session, no placeholder)
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

  const renderSessionTree = (workspacePath: string) => {
    const projectSessions = mergedSessionsByWorkspace[workspacePath] || []
    const loading = loadingSessionPaths.has(workspacePath) && projectSessions.length === 0
    return (
    <div className="sidebar-session-tree ml-3 border-l border-border/40 pl-1.5 pt-0.5">
      {loading ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:loading')}</p>
      ) : projectSessions.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-foreground-secondary/80">{t('common:sidebar.noSessions')}</p>
      ) : (
        <>
        {projectSessions.map((s) => (
          <div
            key={s.sessionId}
            role="button"
            tabIndex={0}
            onClick={() => {
              guardSessionSwitch(() => {
                if (workspacePath === currentWorkspace) {
                  void switchSessionInPlace(s.sessionId, s.sessionFile)
                } else {
                  void activateWorkspace(workspacePath, {
                    sessionId: s.sessionId,
                    sessionFile: s.sessionFile,
                  })
                }
              })
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              guardSessionSwitch(() => {
                if (workspacePath === currentWorkspace) {
                  void switchSessionInPlace(s.sessionId, s.sessionFile)
                } else {
                  void activateWorkspace(workspacePath, {
                    sessionId: s.sessionId,
                    sessionFile: s.sessionFile,
                  })
                }
              })
            }}
            onContextMenu={(e) =>
              sessionMenu.open(e, {
                sessionId: s.sessionId,
                sessionFile: s.sessionFile,
                title: s.title || s.sessionId.slice(0, 8),
                workspacePath,
              })
            }
            className={cn(
              'nav-row sidebar-session-row mb-0.5 flex min-h-[38px] items-center rounded-lg px-2.5 py-1.5',
              currentSessionId === s.sessionId && workspacePath === currentWorkspace
                ? 'nav-row-active'
                : 'text-foreground-secondary hover:text-foreground',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] leading-[18px] text-foreground">
                {s.title || s.sessionId.slice(0, 8)}
              </div>
              <div className="text-[11px] leading-[16px] tabular-nums text-foreground-secondary/85">
                {new Date(s.updatedAt).toLocaleDateString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        ))}
        </>
      )}
    </div>
    )
  }

  const renderDiskProjectRow = (path: string) => {
    const active = path === currentWorkspace
    const open = expandedPaths.has(path)
    const name = diskProjectName(path)
    const toggleOpen = () =>
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })

    return (
      <div
        key={path}
        className="sidebar-project-row mb-0.5"
        onContextMenu={(e) => projectMenu.open(e, path, name)}
      >
        <div
          className={cn(
            'nav-row flex min-h-[36px] items-center gap-0.5 rounded-lg px-0.5',
            (active || open) && 'bg-[var(--bg-hover)]/80',
          )}
        >
          <button
            type="button"
            onClick={toggleOpen}
            className="sidebar-project-hit flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left"
            title={path}
            aria-expanded={open}
          >
            <ChevronRight
              className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary/80"
              data-open={open ? 'true' : 'false'}
            />
            <Folder
              className={cn(
                'folder-icon h-4 w-4 shrink-0 transition-colors duration-200',
                active ? 'text-brand' : 'text-foreground-secondary/70',
              )}
            />
            <span
              className={cn(
                'truncate text-[14px] leading-[20px]',
                active ? 'font-medium text-foreground' : 'text-foreground-secondary',
              )}
            >
              {name}
            </span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void handleNewSessionInProject(path)
            }}
            title={t('common:newSession')}
            className="chrome-icon-btn ml-0.5 cursor-pointer rounded p-1"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <SidebarAnimatedCollapse open={open}>
          {renderSessionTree(path)}
        </SidebarAnimatedCollapse>
      </div>
    )
  }

  const renderSandboxDialogRow = (box: SandboxEntry) => {
    const active = box.path === currentWorkspace && !ephemeralSandboxDraft
    return (
      <div
        key={box.path}
        role="button"
        tabIndex={0}
        onClick={() => void openSandboxDialog(box)}
        onKeyDown={(e) => e.key === 'Enter' && void openSandboxDialog(box)}
        onContextMenu={(e) => sandboxMenu.open(e, box.path, box.label)}
        className={cn(
          'nav-row sidebar-session-row mb-0.5 flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 py-2',
          active ? 'nav-row-active' : 'text-foreground-secondary hover:text-foreground',
        )}
      >
        <Inbox className={cn('h-4 w-4 shrink-0', active ? 'text-brand' : 'opacity-70')} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] leading-[20px] text-foreground">{box.label}</div>
          <div className="text-[11px] leading-[16px] tabular-nums text-foreground-secondary/85">
            {new Date(box.createdAt).toLocaleDateString('zh-CN', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <button type="button" onClick={() => void handleNewSandboxDialog()} title={t('sidebar.tempChat')} className="chrome-icon-btn flex h-8 w-8 items-center justify-center rounded-lg">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" onClick={onOpenProject} title={openProjectLabel} className="chrome-icon-btn flex h-8 w-8 items-center justify-center rounded-lg">
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
            <span className="text-[11px] font-medium tracking-wide text-foreground-secondary/75">{t('common:sidebar.conversations')}</span>
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
          <>
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
                sandboxes.map(renderSandboxDialogRow)
              )}
            </div>

          </>
        </SidebarAnimatedCollapse>
      </div>
      <SandboxContextMenuPortal
        menu={sandboxMenu.menu}
        onClose={sandboxMenu.close}
        onListChange={refreshSandboxes}
      />
      <SessionContextMenuPortal
        menu={sessionMenu.menu}
        onClose={sessionMenu.close}
        onSessionsChange={refreshAllSessionLists}
      />
      <ProjectContextMenuPortal
        menu={projectMenu.menu}
        onClose={projectMenu.close}
        onListChange={refreshAllSessionLists}
      />
      <div className="mt-2 px-1.5">
        <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-foreground-secondary/75">{t('common:sidebar.projects')}</div>
        {diskPaths.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-foreground-secondary/80">{t('sidebar.openProject')}</p>
        ) : (
          diskPaths.map(renderDiskProjectRow)
        )}
      </div>
    </div>
  )
}