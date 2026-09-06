import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight, Folder, FolderOpen, Inbox, Plus, RefreshCw, Search, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { SandboxContextMenuPortal } from './sandbox-context-menu'
import { useSandboxContextMenu } from './use-sandbox-context-menu'
import { SessionContextMenuPortal } from './session-context-menu'
import { useSessionContextMenu } from './use-session-context-menu'
import { ProjectContextMenuPortal } from './project-context-menu'
import { useProjectContextMenu } from './use-project-context-menu'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import {
  diskProjectName,
  isSandboxPath,
  type SandboxEntry,
  type SessionItem,
} from './project-sidebar-types'
import { matchesSessionQuery } from './project-session-tree'
import { projectFolderOrder } from './project-folder-order'
import { ProjectDiskRow, ProjectSessionTree, SandboxDialogRow } from './project-sidebar-rows'
import { groupSidebarProjects } from './project-worktree-groups'
import { useProjectWorktrees } from './use-project-worktrees'
import { uniqueWorkspacePaths, workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import type { GitWorktree } from '@shared/git-worktree'

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
  const sessionsWorkspace = useUIStore((s) => s.sessionsWorkspace)
  const currentKey = workspacePathKey(currentWorkspace)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const [sessionsByWorkspace, setSessionsByWorkspace] = useState<Record<string, SessionItem[]>>({})
  const [loadingSessionPaths, setLoadingSessionPaths] = useState<Set<string>>(() => new Set())
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({})
  const [repositoryOpen, setRepositoryOpen] = useState<Record<string, boolean>>({})
  const [sandboxes, setSandboxes] = useState<SandboxEntry[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [recentProjectsFixedOrder, setRecentProjectsFixedOrder] = useState(false)
  const fixedOrderRef = useRef(false)
  const [sectionOpen, setSectionOpen] = useState(true)
  const [sessionQuery, setSessionQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [sessionScope, setSessionScope] = useState<'project' | 'all'>('project')
  const scopeLabel = t(sessionScope === 'project' ? 'common:sidebar.thisProject' : 'common:sidebar.allProjects')
  const searchActive = sessionQuery.trim().length > 0
  const projectPaths = useMemo(() => projectFolderOrder(
    recentProjects.filter((path) => !isSandboxPath(path)),
    currentWorkspace && !isSandboxPath(currentWorkspace) ? currentWorkspace : null,
    recentProjectsFixedOrder,
  ), [recentProjects, currentWorkspace, recentProjectsFixedOrder])
  const worktrees = useProjectWorktrees(projectPaths)
  const projectGroups = useMemo(() => groupSidebarProjects(
    projectPaths.filter((path) => !worktrees.missingPaths.has(workspacePathKey(path))), worktrees.listings,
  ), [projectPaths, worktrees.listings, worktrees.missingPaths])
  const diskPaths = useMemo(() => projectGroups.flatMap((group) => group.projects.map((project) => project.path)), [projectGroups])
  const activeRepository = projectGroups.find((group) => group.repositoryPath && group.projects.some((project) => workspacePathsEqual(project.path, currentWorkspace)))?.key

  useEffect(() => {
    if (activeRepository) setRepositoryOpen((previous) => ({ ...previous, [activeRepository]: true }))
  }, [activeRepository, currentKey])

  const refreshSandboxes = useCallback(() => {
    ipcClient
      .invoke('workspace.sandbox.list')
      .then((r) => setSandboxes(r?.sandboxes || []))
      .catch(() => setSandboxes([]))
  }, [])

  const sandboxMenu = useSandboxContextMenu(refreshSandboxes)

  const loadWorkspaceSessions = useCallback(async (workspaceId: string) => {
    if (!workspaceId || isSandboxPath(workspaceId)) return
    const key = workspacePathKey(workspaceId)
    setLoadingSessionPaths((previous) => new Set(previous).add(key))
    try {
      await refreshWorkspaceSessionLists({ workspaceIds: [workspaceId] })
    } finally {
      setLoadingSessionPaths((previous) => {
        const next = new Set(previous)
        next.delete(key)
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

  /**
   * 重命名只改标题，列表顺序不变：本地原地更新，避免整列表重拉引起的重渲染闪烁。
   * 主进程已把新标题写入 JSONL，后续任意一次刷新都会读到一致的值。
   */
  const applySessionRenamed = useCallback(
    (payload: { sessionFile: string; title: string; workspacePath: string }) => {
      const { sessionFile, title, workspacePath } = payload
      const applyTitle = (items: SessionItem[]) => {
        let changed = false
        const next = items.map((s) => {
          if (s.sessionFile && sessionFilesEqual(s.sessionFile, sessionFile)) {
            changed = true
            return { ...s, title }
          }
          return s
        })
        return changed ? next : items
      }
      setSessionsByWorkspace((previous) => {
        const key = workspacePathKey(workspacePath)
        const current = previous[key]
        if (!current) return previous
        const next = applyTitle(current)
        return next === current ? previous : { ...previous, [key]: next }
      })
      if (workspacePathsEqual(workspacePath, useUIStore.getState().currentWorkspace)) {
        useUIStore.setState((state) => {
          const next = applyTitle(state.sessions)
          return next === state.sessions ? {} : { sessions: next }
        })
      }
    },
    [],
  )

  /**
   * 删除确认后立即从侧栏移除条目：删除 IPC 要等 worker 重建 runtime，先给用户即时反馈，
   * 删除完成或失败后再以整列表刷新校准。
   */
  const applySessionRemoved = useCallback(
    (payload: { sessionFile: string; workspacePath: string }) => {
      const { sessionFile, workspacePath } = payload
      const removeByFile = (items: SessionItem[]) =>
        items.filter((s) => !(s.sessionFile && sessionFilesEqual(s.sessionFile, sessionFile)))
      setSessionsByWorkspace((previous) => {
        const key = workspacePathKey(workspacePath)
        const current = previous[key]
        if (!current) return previous
        const next = removeByFile(current)
        return next.length === current.length ? previous : { ...previous, [key]: next }
      })
      if (workspacePathsEqual(workspacePath, useUIStore.getState().currentWorkspace)) {
        useUIStore.setState((state) => {
          const next = removeByFile(state.sessions)
          return next.length === state.sessions.length ? {} : { sessions: next }
        })
      }
    },
    [],
  )

  const sessionMenu = useSessionContextMenu(refreshSessionsAfterMutation)
  const projectMenu = useProjectContextMenu(refreshSessionsAfterMutation)

  useEffect(() => {
    const onChanged = () => refreshSandboxes()
    window.addEventListener('pi-desktop:sandboxes-changed', onChanged)
    return () => window.removeEventListener('pi-desktop:sandboxes-changed', onChanged)
  }, [refreshSandboxes])

  const reloadSidebarSettings = useCallback(() => {
    ipcClient
      .invoke('settings.get', { key: 'recentProjects' })
      .then((res) => {
        if (workspacePathKey(useUIStore.getState().currentWorkspace) !== workspacePathKey(currentWorkspace)) return
        const list = res?.settings?.recentProjects as string[] | undefined
        if (list) {
          const diskOnly = list.filter((p) => !isSandboxPath(p))
          const merged = [...diskOnly]
          if (currentWorkspace && !isSandboxPath(currentWorkspace) && !merged.includes(currentWorkspace)) {
            if (fixedOrderRef.current) merged.push(currentWorkspace)
            else merged.unshift(currentWorkspace)
          }
          const next = uniqueWorkspacePaths(merged).slice(0, 16)
          useUIStore.setState((state) => {
            // 顺序/内容无变化时保持引用稳定，避免固定顺序下每次切换工作区都触发整个侧栏重渲染
            const prev = state.recentProjects
            if (prev.length === next.length && prev.every((p, i) => p === next[i])) return {}
            return { recentProjects: next }
          })
        }
      })
      .catch(() => {})
    ipcClient
      .invoke('settings.get', { key: 'recentProjectsFixedOrder' })
      .then((res) => {
        const v = res?.settings?.recentProjectsFixedOrder === true
        fixedOrderRef.current = v
        setRecentProjectsFixedOrder(v)
      })
      .catch(() => {})
  }, [currentWorkspace])

  useEffect(() => {
    refreshSandboxes()
    reloadSidebarSettings()
  }, [refreshSandboxes, reloadSidebarSettings])

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined
      if (!detail?.key || detail.key === 'recentProjects' || detail.key === 'recentProjectsFixedOrder') {
        reloadSidebarSettings()
      }
    }
    window.addEventListener('pi-desktop:settings-changed', onSettingsChanged)
    return () => window.removeEventListener('pi-desktop:settings-changed', onSettingsChanged)
  }, [reloadSidebarSettings])

  // Current project only on startup / workspace switch — never every recent project.
  useEffect(() => {
    if (!currentWorkspace || isSandboxPath(currentWorkspace)) return
    const frame = requestAnimationFrame(() => {
      setExpandedPaths((previous) => {
        if (previous.has(currentKey)) return previous
        return new Set(previous).add(currentKey)
      })
      void loadWorkspaceSessions(currentWorkspace)
    })
    return () => cancelAnimationFrame(frame)
  }, [currentWorkspace, currentKey, loadWorkspaceSessions])

  useEffect(() => {
    const onWorkspaceSessions = (event: Event) => {
      const { workspaceId, sessions: list, error } = (event as CustomEvent).detail as {
        workspaceId: string
        sessions?: SessionItem[]
        error?: string
      }
      const key = workspacePathKey(workspaceId)
      setSessionErrors((previous) => ({ ...previous, [key]: error || '' }))
      if (list) setSessionsByWorkspace((previous) => ({ ...previous, [key]: list }))
    }
    window.addEventListener('pi-desktop:workspace-sessions', onWorkspaceSessions)
    return () => window.removeEventListener('pi-desktop:workspace-sessions', onWorkspaceSessions)
  }, [])

  useEffect(() => {
    if (sessionScope !== 'all' || !searchActive) return
    let cancelled = false
    void (async () => {
      for (const path of diskPaths) {
        if (cancelled) return
        if (!workspacePathsEqual(path, currentWorkspace)) await loadWorkspaceSessions(path)
      }
    })()
    return () => { cancelled = true }
  }, [sessionScope, searchActive, diskPaths, currentWorkspace, loadWorkspaceSessions])

  const switchDiskProject = async (path: string) => {
    if (workspacePathsEqual(path, currentWorkspace) && !ephemeralSandboxDraft) return
    try {
      await activateWorkspace(path)
    } catch (e) {
      console.error('[ProjectSidebar] switch failed:', e)
    }
  }

  const handleNewSandboxDialog = () => {
    enterBlankSession('ephemeral-sandbox')
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
      if (!workspacePathsEqual(workspacePath, currentWorkspace)) {
        await activateWorkspace(workspacePath, { preferHome: true })
      } else {
        enterBlankSession('pending-project')
        void import('@renderer/lib/composer-run-display').then((m) => m.refreshComposerRunDisplay())
      }
      setExpandedPaths((prev) => new Set(prev).add(workspacePathKey(workspacePath)))
    } catch (e) {
      console.error('New session (home) failed:', e)
    }
  }

  useEffect(() => {
    if (!currentWorkspace || isSandboxPath(currentWorkspace)) return
    if (sessions.length === 0 && !workspacePathsEqual(sessionsWorkspace, currentWorkspace)) return
    setSessionsByWorkspace((previous) => previous[currentKey] === sessions ? previous : { ...previous, [currentKey]: sessions })
  }, [currentWorkspace, currentKey, sessionsWorkspace, sessions])

  const mergedSessionsByWorkspace = useMemo(() => {
    const next = { ...sessionsByWorkspace }
    if (currentWorkspace && !isSandboxPath(currentWorkspace)) {
      if (sessions.length > 0 || workspacePathsEqual(sessionsWorkspace, currentWorkspace)) {
        next[currentKey] = sessions
      }
    }
    return next
  }, [sessionsByWorkspace, currentWorkspace, currentKey, sessionsWorkspace, sessions])

  const visiblePaths = searchActive
    ? diskPaths.filter((path) => (sessionScope === 'all' || workspacePathsEqual(path, currentWorkspace))
      && (mergedSessionsByWorkspace[workspacePathKey(path)]?.some((session) => matchesSessionQuery(session, sessionQuery)) || loadingSessionPaths.has(workspacePathKey(path)) || sessionErrors[workspacePathKey(path)]))
    : diskPaths
  const visibleSandboxes = searchActive
    ? sandboxes.filter((box) => (sessionScope === 'all' || box.path === currentWorkspace)
      && box.label.toLowerCase().includes(sessionQuery.trim().toLowerCase()))
    : sandboxes

  const renderProject = (project: GitWorktree, grouped: boolean) => {
    const { path } = project
    const key = workspacePathKey(path)
    const open = searchActive || expandedPaths.has(key)
    const rows = mergedSessionsByWorkspace[key] || []
    return <ProjectDiskRow
      key={key}
      path={path}
      name={grouped && project.isMain ? t('common:sidebar.mainWorktree') : diskProjectName(path)}
      branch={project.detached ? t('common:sidebar.detachedWorktree') : project.branch}
      worktree={grouped}
      active={workspacePathsEqual(path, currentWorkspace)}
      open={open}
      onOpenProject={() => {
        setExpandedPaths((previous) => new Set(previous).add(key))
        void switchDiskProject(path)
      }}
      onToggleOpen={() => {
        const willExpand = !expandedPaths.has(key)
        setExpandedPaths((previous) => {
          const next = new Set(previous)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
        if (willExpand && !(key in mergedSessionsByWorkspace)) void loadWorkspaceSessions(path)
      }}
      onNewSession={() => void handleNewSessionInProject(path)}
      onProjectContextMenu={(event) => projectMenu.open(event, path, diskProjectName(path))}
      sessionTree={<ProjectSessionTree
        workspacePath={path}
        projectSessions={rows}
        searchQuery={sessionQuery}
        loading={loadingSessionPaths.has(key) && rows.length === 0}
        error={sessionErrors[key]}
        onRetry={() => void loadWorkspaceSessions(path)}
        currentWorkspace={currentWorkspace}
        currentSessionId={currentSessionId}
        onSessionContextMenu={(event, payload) => sessionMenu.open(event, payload)}
      />}
    />
  }

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
      <div className="sidebar-search-block border-b border-border/40 px-3 py-3">
        <button
          type="button"
          onClick={onOpenProject}
          className="nav-row row-hover flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] font-medium text-foreground-secondary hover:text-foreground"
        >
          <FolderOpen className="h-4 w-4 shrink-0" />
          {openProjectLabel}
        </button>
        <div className="workbench-search sidebar-search mt-2">
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            aria-label={t('common:sidebar.searchSessions')}
            aria-description={`${t('common:sidebar.searchScope')}: ${scopeLabel}`}
            placeholder={t('common:sidebar.searchSessions')}
          />
          {searchActive && <button type="button" className="workbench-icon" aria-label={t('common:sidebar.clearSearch')} onClick={() => {
            setSessionQuery('')
            searchInputRef.current?.focus()
          }}><X className="h-3.5 w-3.5" /></button>}
          <button
            type="button"
            role="switch"
            className="sidebar-search-scope"
            aria-label={t('common:sidebar.allProjects')}
            aria-checked={sessionScope === 'all'}
            title={`${t('common:sidebar.searchScope')}: ${scopeLabel}`}
            onClick={() => setSessionScope((scope) => scope === 'project' ? 'all' : 'project')}
          >
            <span>{t(sessionScope === 'project' ? 'common:sidebar.scopeProject' : 'common:sidebar.scopeAll')}</span>
            <span className="sidebar-search-scope-track" aria-hidden />
          </button>
        </div>
      </div>
      {searchActive && !visiblePaths.length && !visibleSandboxes.length && <div className="px-4 py-6 text-center text-xs text-foreground-secondary"><p>{t('common:sidebar.noResults')}</p><button type="button" className="workbench-button mt-2" onClick={() => setSessionQuery('')}>{t('common:sidebar.clearSearch')}</button></div>}

      <div className="px-1.5 pt-2" hidden={searchActive && visibleSandboxes.length === 0}>
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
        <SidebarAnimatedCollapse open={searchActive || sectionOpen}>
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
              visibleSandboxes.map((box) => (
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
        onSessionRenamed={applySessionRenamed}
        onSessionRemoved={applySessionRemoved}
      />
      <ProjectContextMenuPortal
        menu={projectMenu.menu}
        onClose={projectMenu.close}
        onListChange={refreshSessionsAfterMutation}
      />

      <div className="mt-3 px-1.5" hidden={searchActive && visiblePaths.length === 0}>
        <div className="flex min-h-8 items-center gap-2 px-2 pb-1 text-[11px] font-medium text-foreground-secondary/75">
          <span className="flex-1">{t('common:sidebar.projects')}</span>
          <button type="button" className="workbench-icon" disabled={worktrees.loading} aria-label={t('common:sidebar.refreshProjects')} onClick={() => {
            worktrees.refresh()
            reloadSidebarSettings()
            const visible = diskPaths.filter((path) => expandedPaths.has(workspacePathKey(path)))
            void refreshWorkspaceSessionLists({ workspaceIds: visible })
          }}><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
        {worktrees.failed && <div role="status" className="px-3 pb-2 text-xs text-foreground-secondary">{t('common:sidebar.worktreeReadFailed')}</div>}
        {diskPaths.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-foreground-secondary/80">{t('sidebar.openProject')}</p>
        ) : (
          projectGroups.map((group) => {
            const projects = group.projects.filter((project) => visiblePaths.includes(project.path))
            if (!projects.length) return null
            if (!group.repositoryPath) return projects.map((project) => renderProject(project, false))
            const name = diskProjectName(group.repositoryPath)
            const open = searchActive || (repositoryOpen[group.key] ?? group.key === activeRepository)
            return <div key={group.key} className="sidebar-repository-group mb-2" role="group" aria-label={name} data-repository={group.repositoryPath}>
              <button type="button" className="sidebar-repository-hit flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-[var(--bg-hover)]" aria-expanded={open} title={group.repositoryPath} onClick={() => setRepositoryOpen((previous) => ({ ...previous, [group.key]: !open }))}>
                <ChevronRight className="chevron-expand h-3.5 w-3.5 shrink-0 text-foreground-secondary" data-open={open ? 'true' : 'false'} />
                <Folder className="h-4 w-4 shrink-0 text-foreground-secondary" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-foreground-secondary" title={t('common:sidebar.worktreeCount', { count: group.projects.length })}>{group.projects.length}</span>
              </button>
              <SidebarAnimatedCollapse open={open}>
                <div className="ml-3 border-l border-border/40 pl-1.5 pt-1">{projects.map((project) => renderProject(project, true))}</div>
              </SidebarAnimatedCollapse>
            </div>
          })
        )}
      </div>
    </div>
  )
}
