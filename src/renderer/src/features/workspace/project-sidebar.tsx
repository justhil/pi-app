import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createSidebarShiftGuard } from '@renderer/lib/sidebar-shift-guard'
import {
  SessionPinGlyph,
  isSessionPinned,
  pinnedSessionKey,
  removePinnedSession,
  toggleSessionPinned,
  updatePinnedSessionSnapshot,
} from '@renderer/lib/pinned-sessions'
import { selectSessionAttention } from '@renderer/lib/session-attention'
import { SessionAttentionDot } from './session-attention-dot'
import { cn } from '@renderer/lib/utils'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight, Folder, FolderOpen, PencilLine, Plus, Search, X } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { SandboxContextMenuPortal } from './sandbox-context-menu'
import { useSandboxContextMenu } from './use-sandbox-context-menu'
import { SessionContextMenuPortal } from './session-context-menu'
import { useSessionContextMenu } from './use-session-context-menu'
import { ProjectContextMenuPortal } from './project-context-menu'
import { useProjectContextMenu } from './use-project-context-menu'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import { SIDEBAR_RELOAD_EVENT } from '@renderer/lib/reload-current-session-data'
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
import { resolveProjectDisplayName, uniqueWorkspacePaths, workspacePathKey, workspacePathsEqual } from '@shared/workspace-path'
import type { GitWorktree } from '@shared/git-worktree'

const TEMP_CHATS_OPEN_KEY = 'pi-desktop:sidebar-temp-chats-open'

function readSectionOpen(): boolean {
  try {
    return localStorage.getItem(TEMP_CHATS_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSectionOpen(open: boolean): void {
  try {
    localStorage.setItem(TEMP_CHATS_OPEN_KEY, open ? '1' : '0')
  } catch {
    /* storage unavailable: session-only state */
  }
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
  const showBrand = useUIStore((s) => s.uiCustomization.shellSidebarShowBrand)
  const showNewChat = useUIStore((s) => s.uiCustomization.shellSidebarShowNewChat)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const recentProjects = useUIStore((s) => s.recentProjects)
  const projectDisplayNames = useUIStore((s) => s.projectDisplayNames)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const pinnedSessions = useUIStore((s) => s.pinnedSessions)
  const pinnedSessionMeta = useUIStore((s) => s.pinnedSessionMeta)
  const sessionAttention = useUIStore((s) => s.sessionAttention)
  const [pinnedOpen, setPinnedOpen] = useState(true)
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
  const [recentProjectsFixedOrder, setRecentProjectsFixedOrder] = useState(true)
  const fixedOrderRef = useRef(true)
  // Temporary chats start collapsed (remembered); they open by themselves when the active
  // conversation lives there (new temp chat / opened sandbox) so it is never hidden.
  const [sectionOpen, setSectionOpenState] = useState(() => readSectionOpen())
  const autoOpenedRef = useRef(false)
  const setSectionOpen = useCallback((next: boolean) => {
    autoOpenedRef.current = false
    setSectionOpenState(next)
    writeSectionOpen(next)
  }, [])
  const [sessionQuery, setSessionQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [sessionScope, setSessionScope] = useState<'project' | 'all'>('project')
  const scopeLabel = t(sessionScope === 'project' ? 'common:sidebar.thisProject' : 'common:sidebar.allProjects')
  const searchActive = sessionQuery.trim().length > 0
  const searchOpen = searchExpanded || searchActive
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
      const targetPath = workspacePath || useUIStore.getState().currentWorkspace
      if (targetPath && !isSandboxPath(targetPath)) {
        void loadWorkspaceSessions(targetPath)
        return
      }
      void refreshWorkspaceSessionLists()
    },
    [loadWorkspaceSessions],
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
      updatePinnedSessionSnapshot(sessionFile, { title, workspacePath })
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
      removePinnedSession(sessionFile)
    },
    [],
  )

  // Judge by the path, not by the loaded list: a temp chat's first message moves the view into a
  // sandbox that is listed only once its session is bound, and in that gap the section folded away.
  const activeInTempChats = !!ephemeralSandboxDraft || (!!currentWorkspace && isSandboxPath(currentWorkspace))
  // Auto-open is not remembered — only the user's own toggles are — and it folds back once the
  // active conversation leaves temp chats (the app starts in a temp-chat draft).
  const sectionOpenRef = useRef(sectionOpen)
  sectionOpenRef.current = sectionOpen
  useEffect(() => {
    if (activeInTempChats) {
      if (sectionOpenRef.current) return
      autoOpenedRef.current = true
      setSectionOpenState(true)
    } else if (autoOpenedRef.current) {
      autoOpenedRef.current = false
      setSectionOpenState(false)
    }
  }, [activeInTempChats])

  const sessionMenu = useSessionContextMenu(refreshSessionsAfterMutation)
  useEffect(() => {
    void Promise.all([
      ipcClient.invoke('settings.get', { key: 'pinnedSessions' }).catch(() => null),
      ipcClient.invoke('settings.get', { key: 'pinnedSessionMeta' }).catch(() => null),
    ]).then(([sRes, mRes]) => {
      const savedList = Array.isArray(sRes?.settings?.pinnedSessions)
        ? (sRes.settings.pinnedSessions as string[])
        : []
      const savedMeta =
        mRes?.settings?.pinnedSessionMeta && typeof mRes.settings.pinnedSessionMeta === 'object'
          ? (mRes.settings.pinnedSessionMeta as Record<string, import('@renderer/stores/ui-store-types').PinnedSessionRecord>)
          : {}
      const cur = useUIStore.getState()
      const mergedList = cur.pinnedSessions.length > 0 ? cur.pinnedSessions : savedList
      if (mergedList.length > 0 || Object.keys(savedMeta).length > 0) {
        cur.setPinnedSessions(mergedList, savedMeta)
      }
    })
  }, [])

  // Backfill legacy pinnedSessions that lack metadata snapshots using session.prepare + display names
  const backfilledPinsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!pinnedSessions.length) return
    let cancelled = false
    for (const pinnedFile of pinnedSessions) {
      const k = pinnedSessionKey(pinnedFile)
      if (!k || backfilledPinsRef.current.has(k)) continue
      const existing = pinnedSessionMeta[k]
      if (existing?.workspacePath && existing?.title) continue
      backfilledPinsRef.current.add(k)
      void Promise.all([
        ipcClient.invoke('session.prepare', { sessionFile: pinnedFile, bind: false }).catch(() => null),
        ipcClient.invoke('settings.get', { key: 'sessionDisplayNames' }).catch(() => null),
      ]).then(([prepared, namesRes]) => {
        if (cancelled || !prepared?.workspaceId) return
        const names = (namesRes?.settings?.sessionDisplayNames ?? {}) as Record<string, string>
        const fallbackTitle =
          names[k] ||
          names[pinnedFile] ||
          existing?.title ||
          (prepared.sessionId ? String(prepared.sessionId).slice(0, 8) : pinnedFile.split(/[\\/]/).pop() || '')
        updatePinnedSessionSnapshot(pinnedFile, {
          sessionId: prepared.sessionId || existing?.sessionId || '',
          workspacePath: prepared.workspaceId,
          title: fallbackTitle,
          kind: isSandboxPath(prepared.workspaceId) ? 'sandbox' : 'project',
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [pinnedSessions, pinnedSessionMeta])

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
          if (currentWorkspace && !isSandboxPath(currentWorkspace) && !merged.some((p) => workspacePathsEqual(p, currentWorkspace))) {
            if (fixedOrderRef.current) merged.push(currentWorkspace)
            else merged.unshift(currentWorkspace)
          }
          const next = uniqueWorkspacePaths(merged)
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
        const v = res?.settings?.recentProjectsFixedOrder !== false
        fixedOrderRef.current = v
        setRecentProjectsFixedOrder(v)
      })
      .catch(() => {})
    ipcClient
      .invoke('settings.get', { key: 'projectDisplayNames' })
      .then((res) => {
        const names = res?.settings?.projectDisplayNames as Record<string, string> | undefined
        if (names && typeof names === 'object') {
          useUIStore.setState({ projectDisplayNames: names })
        }
      })
      .catch(() => {})
  }, [currentWorkspace])

  const handleProjectListChange = useCallback(() => {
    worktrees.refresh()
    reloadSidebarSettings()
    refreshSessionsAfterMutation()
  }, [worktrees, reloadSidebarSettings, refreshSessionsAfterMutation])
  const projectMenu = useProjectContextMenu(handleProjectListChange)

  useEffect(() => {
    refreshSandboxes()
    reloadSidebarSettings()
  }, [refreshSandboxes, reloadSidebarSettings])

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined
      if (
        !detail?.key ||
        detail.key === 'recentProjects' ||
        detail.key === 'recentProjectsFixedOrder' ||
        detail.key === 'projectDisplayNames'
      ) {
        reloadSidebarSettings()
      }
    }
    window.addEventListener('pi-desktop:settings-changed', onSettingsChanged)
    return () => window.removeEventListener('pi-desktop:settings-changed', onSettingsChanged)
  }, [reloadSidebarSettings])

  // The top-right reload button also refreshes projects, worktrees and open session lists.
  const refreshProjects = useRef<() => void>(() => {})
  refreshProjects.current = () => {
    worktrees.refresh()
    reloadSidebarSettings()
    refreshSandboxes()
    const visible = diskPaths.filter((path) => expandedPaths.has(workspacePathKey(path)))
    void refreshWorkspaceSessionLists({ workspaceIds: visible })
  }
  useEffect(() => {
    const onReload = () => refreshProjects.current()
    window.addEventListener(SIDEBAR_RELOAD_EVENT, onReload)
    const onBranchSwitched = () => worktrees.refresh()
    window.addEventListener('pi-desktop:git-branch-switched', onBranchSwitched)
    const offGit =
      typeof window.piDesktop?.onGitWorkspaceChanged === 'function'
        ? window.piDesktop.onGitWorkspaceChanged(() => worktrees.refresh())
        : () => {}
    return () => {
      window.removeEventListener(SIDEBAR_RELOAD_EVENT, onReload)
      window.removeEventListener('pi-desktop:git-branch-switched', onBranchSwitched)
      if (typeof offGit === 'function') offGit()
    }
  }, [worktrees])

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

  const renderProject = (project: GitWorktree, grouped: boolean, repositoryPath?: string | null, siblingPaths?: string[]) => {
    const { path } = project
    const key = workspacePathKey(path)
    const open = searchActive || expandedPaths.has(key)
    const rows = mergedSessionsByWorkspace[key] || []
    const fallbackName = grouped && project.isMain ? t('common:sidebar.mainWorktree') : diskProjectName(path)
    const displayName = resolveProjectDisplayName(projectDisplayNames, path, fallbackName, { grouped })
    return <ProjectDiskRow
      key={key}
      path={path}
      name={displayName}
      branch={project.detached ? t('common:sidebar.detachedWorktree') : project.branch}
      worktree={grouped}
      active={workspacePathsEqual(path, currentWorkspace)}
      open={open}
      onOpenProject={() => {
        if (!searchActive && expandedPaths.has(key)) {
          setExpandedPaths((previous) => {
            const next = new Set(previous)
            next.delete(key)
            return next
          })
          return
        }
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
      onProjectContextMenu={(event) =>
        projectMenu.open(event, path, displayName, {
          repositoryPath: repositoryPath || path,
          isSecondaryWorktree: grouped && !project.isMain,
          siblingPaths,
        })
      }
      onBranchSwitched={() => worktrees.refresh()}
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

  const sidebarContainerRef = useRef<HTMLDivElement>(null)
  const shiftGuardRef = useRef<ReturnType<typeof createSidebarShiftGuard> | null>(null)
  useEffect(() => {
    const el = sidebarContainerRef.current
    if (!el) return
    const guard = createSidebarShiftGuard(el)
    shiftGuardRef.current = guard
    return () => {
      guard.dispose()
      shiftGuardRef.current = null
    }
  }, [collapsed])
  useLayoutEffect(() => {
    shiftGuardRef.current?.update()
  })

  // Keep pinned conversations visible in place inside their own section too (never vanish from source list).
  const sortedVisibleSandboxes = visibleSandboxes

  // Bulletproof pinned list: merges live loaded sessions/sandboxes with persisted pinnedSessionMeta snapshot
  // so pinned sessions NEVER disappear after restart, project switch, or collapsing a project!
  const pinnedQuickItems = useMemo(() => {
    if (!pinnedSessions.length) return []
    const out: Array<{
      kind: 'project' | 'sandbox'
      sessionFile: string
      sessionId: string
      workspacePath: string
      title: string
      sourceLabel: string
      sandboxBox?: SandboxEntry
    }> = []

    for (const pinnedFile of pinnedSessions) {
      const k = pinnedSessionKey(pinnedFile)
      const snap = pinnedSessionMeta[k] ?? pinnedSessionMeta[k.toLowerCase()] ?? pinnedSessionMeta[k.toLowerCase()]

      // 1. Live sandbox match
      const sb = sandboxes.find((b) => sessionFilesEqual(b.sessionFile, pinnedFile))
      if (sb) {
        out.push({
          kind: 'sandbox',
          sessionFile: sb.sessionFile || pinnedFile,
          sessionId: sb.sessionId || snap?.sessionId || '',
          workspacePath: sb.path,
          title: sb.label?.trim() || snap?.title || t('common:sidebar.tempChat'),
          sourceLabel: t('common:sidebar.conversations'),
          sandboxBox: sb,
        })
        continue
      }

      // 2. Live project session match across all loaded workspaces
      let liveHit: { session: SessionItem; path: string } | null = null
      for (const path of diskPaths) {
        const list = workspacePathsEqual(path, currentWorkspace)
          ? sessions
          : (sessionsByWorkspace[workspacePathKey(path)] ?? [])
        const hit = list.find((s) => sessionFilesEqual(s.sessionFile, pinnedFile))
        if (hit) {
          liveHit = { session: hit, path }
          break
        }
      }
      if (liveHit) {
        out.push({
          kind: 'project',
          sessionFile: liveHit.session.sessionFile || pinnedFile,
          sessionId: liveHit.session.sessionId,
          workspacePath: liveHit.path,
          title: liveHit.session.title || snap?.title || liveHit.session.sessionId.slice(0, 8),
          sourceLabel: resolveProjectDisplayName(projectDisplayNames, liveHit.path, diskProjectName(liveHit.path)),
        })
        continue
      }

      // 3. Fallback to persisted snapshot (unloaded project / cold boot / switched workspace -> NEVER vanishes!)
      const fallbackWorkspace = snap?.workspacePath || ''
      const isSb = snap?.kind === 'sandbox' || (fallbackWorkspace ? isSandboxPath(fallbackWorkspace) : false)
      out.push({
        kind: isSb ? 'sandbox' : 'project',
        sessionFile: snap?.sessionFile || pinnedFile,
        sessionId: snap?.sessionId || '',
        workspacePath: fallbackWorkspace,
        title:
          snap?.title ||
          (snap?.sessionId ? snap.sessionId.slice(0, 8) : pinnedFile.split(/[\\/]/).pop()?.replace(/\.jsonl$/i, '') || t('common:sidebar.tempChat')),
        sourceLabel: isSb
          ? t('common:sidebar.conversations')
          : fallbackWorkspace
            ? resolveProjectDisplayName(projectDisplayNames, fallbackWorkspace, diskProjectName(fallbackWorkspace))
            : '',
      })
    }
    return out
  }, [pinnedSessions, pinnedSessionMeta, sandboxes, diskPaths, currentWorkspace, sessions, sessionsByWorkspace, projectDisplayNames, t])

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

  const handleQuickNewThread = () => {
    if (currentWorkspace && !isSandboxPath(currentWorkspace)) {
      void handleNewSessionInProject(currentWorkspace)
      return
    }
    if (diskPaths[0]) {
      void handleNewSessionInProject(diskPaths[0])
      return
    }
    void handleNewSandboxDialog()
  }

  const renderSearchTrigger = () => (
    <button
      type="button"
      data-pi-slot="sidebar-search-trigger"
      title={t('common:sidebar.search')}
      aria-label={t('common:sidebar.search')}
      aria-pressed={searchOpen}
      onClick={() => {
        if (searchOpen && !searchActive) {
          setSearchExpanded(false)
        } else {
          setSearchExpanded(true)
          requestAnimationFrame(() => searchInputRef.current?.focus())
        }
      }}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        searchOpen
          ? 'bg-foreground/[0.08] text-foreground'
          : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
      )}
    >
      <Search className="h-[15px] w-[15px]" strokeWidth={1.6} />
    </button>
  )

  return (
    <div ref={sidebarContainerRef} className="flex h-full min-h-0 flex-col">
      {/* Fixed 48px column header aligned horizontally with Activity Rail, Main Header & Right Dock */}
      {showBrand ? (
        <div
          data-pi-slot="sidebar-header"
          className="flex h-12 shrink-0 items-center justify-between pl-5 pr-3 select-none"
        >
          <span className="text-[16px] font-semibold tracking-[-0.025em] text-foreground">pi</span>
          <div className="flex items-center gap-0.5">{renderSearchTrigger()}</div>
        </div>
      ) : (
        <div data-pi-slot="sidebar-header" className="h-2 shrink-0" aria-hidden />
      )}

      {/* Scrollable sidebar body with a single strong x=20px optical left axis (px-3 outer + px-2 row) */}
      <OverlayScrollHost
        className="sidebar-scroll-host min-h-0 flex-1"
        scrollClassName="pb-4"
        showRailOnHostHover
      >
        {/* Expandable inline search */}
        {searchOpen ? (
          <div className="sidebar-search-block px-3 pb-2">
            <div className="workbench-search sidebar-search">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <input
                ref={searchInputRef}
                type="search"
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSessionQuery('')
                    setSearchExpanded(false)
                  }
                }}
                onBlur={() => {
                  if (!sessionQuery.trim()) setSearchExpanded(false)
                }}
                aria-label={t('common:sidebar.searchSessions')}
                aria-description={`${t('common:sidebar.searchScope')}: ${scopeLabel}`}
                placeholder={t('common:sidebar.searchSessions')}
              />
              <button
                type="button"
                className="workbench-icon"
                aria-label={t('common:sidebar.clearSearch')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (sessionQuery) {
                    setSessionQuery('')
                    searchInputRef.current?.focus()
                  } else {
                    setSearchExpanded(false)
                  }
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                role="switch"
                className="sidebar-search-scope"
                aria-label={t('common:sidebar.allProjects')}
                aria-checked={sessionScope === 'all'}
                title={`${t('common:sidebar.searchScope')}: ${scopeLabel}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSessionScope((scope) => (scope === 'project' ? 'all' : 'project'))}
              >
                <span>{t(sessionScope === 'project' ? 'common:sidebar.scopeProject' : 'common:sidebar.scopeAll')}</span>
                <span className="sidebar-search-scope-track" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}

        {/* Primary quiet action row matching Codex "新聊天" */}
        {showNewChat ? (
          <div className="flex items-center gap-1 px-3">
            <button
              type="button"
              data-pi-slot="sidebar-new-chat"
              onClick={handleQuickNewThread}
              className="nav-row flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground/90 transition-colors hover:text-foreground"
            >
              <PencilLine className="h-[15px] w-[15px] shrink-0 text-foreground-secondary/80" strokeWidth={1.6} />
              <span className="truncate">{t('common:sidebar.newChat')}</span>
            </button>
            {!showBrand ? renderSearchTrigger() : null}
          </div>
        ) : null}

        {searchActive && !visiblePaths.length && !visibleSandboxes.length && (
          <div className="px-5 py-6 text-center text-xs text-foreground-secondary">
            <p>{t('common:sidebar.noResults')}</p>
            <button
              type="button"
              className="workbench-button mt-2"
              onClick={() => {
                setSessionQuery('')
                setSearchExpanded(false)
              }}
            >
              {t('common:sidebar.clearSearch')}
            </button>
          </div>
        )}

        {/* Pinned Shortcuts (always at the top of the sidebar; sessions remain inside their own project folders too) */}
        {pinnedQuickItems.length > 0 && !searchActive ? (
          <div className={cn(showNewChat ? 'mt-5' : 'mt-1', 'px-3')} data-pi-slot="sidebar-pinned-section">
            <div className="sidebar-section-head">
              <button
                type="button"
                onClick={() => setPinnedOpen((v) => !v)}
                className="sidebar-section-hit flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
                aria-expanded={pinnedOpen}
              >
                <span className="sidebar-section-title">{t('common:sidebar.pinnedSection')}</span>
                <ChevronRight
                  className="chevron-expand h-3 w-3 shrink-0 text-foreground-secondary/50"
                  data-open={pinnedOpen ? 'true' : 'false'}
                />
              </button>
            </div>
            <SidebarAnimatedCollapse open={pinnedOpen}>
              <div className="space-y-0.5">
                {pinnedQuickItems.map((entry) => {
                  const attention = selectSessionAttention(entry.sessionFile, sessionAttention)
                  const active =
                    !ephemeralSandboxDraft &&
                    sessionFilesEqual(historySessionFile, entry.sessionFile)
                  const openPinned = async () => {
                    if (entry.sandboxBox) {
                      await openSandboxDialog(entry.sandboxBox)
                      return
                    }
                    let targetWs = entry.workspacePath
                    let targetId = entry.sessionId
                    if (!targetWs || !targetId) {
                      const prepared = await ipcClient
                        .invoke('session.prepare', { sessionFile: entry.sessionFile, bind: false })
                        .catch(() => null)
                      if (prepared?.workspaceId) targetWs = prepared.workspaceId
                      if (prepared?.sessionId) targetId = prepared.sessionId
                    }
                    if (!targetWs) return
                    await activateWorkspace(targetWs, {
                      sessionId: targetId || undefined,
                      sessionFile: entry.sessionFile,
                    })
                  }
                  return (
                    <div
                      key={entry.sessionFile}
                      role="button"
                      tabIndex={0}
                      title={entry.sourceLabel ? `${entry.title} · ${entry.sourceLabel}` : entry.title}
                      onClick={() => void openPinned()}
                      onKeyDown={(e) => e.key === 'Enter' && void openPinned()}
                      onContextMenu={(e) => {
                        if (entry.kind === 'sandbox' && entry.sandboxBox) {
                          sandboxMenu.open(e, entry.sandboxBox)
                        } else if (entry.workspacePath) {
                          sessionMenu.open(e, {
                            sessionId: entry.sessionId,
                            sessionFile: entry.sessionFile,
                            title: entry.title,
                            workspacePath: entry.workspacePath,
                          })
                        }
                      }}
                      className={cn(
                        'nav-row group flex h-[34px] items-center gap-2 rounded-lg px-2 text-[13px]',
                        active ? 'nav-row-active text-foreground' : 'text-foreground/85 hover:text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate',
                          active && 'font-medium text-foreground',
                          attention === 'done' && 'font-semibold text-foreground',
                        )}
                      >
                        {entry.title}
                      </span>
                      {entry.sourceLabel ? (
                        <span className="max-w-[72px] shrink-0 truncate text-[11px] text-foreground-secondary/45 group-hover:hidden">
                          {entry.sourceLabel}
                        </span>
                      ) : null}
                      <SessionAttentionDot attention={attention} className="shrink-0 group-hover:hidden" />
                      <button
                        type="button"
                        title={t('common:sidebar.unpinSession')}
                        aria-label={t('common:sidebar.unpinSession')}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          toggleSessionPinned(entry.sessionFile)
                        }}
                        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-secondary/75 hover:bg-foreground/[0.08] hover:text-foreground group-hover:inline-flex"
                      >
                        <SessionPinGlyph className="h-3 w-3" filled />
                      </button>
                    </div>
                  )
                })}
              </div>
            </SidebarAnimatedCollapse>
          </div>
        ) : null}

        {/* Primary Section: Projects & Sessions */}
        <div className={cn(pinnedQuickItems.length > 0 && !searchActive ? 'mt-5' : showNewChat ? 'mt-5' : 'mt-1', 'px-3')} hidden={searchActive && visiblePaths.length === 0}>
          <div className="sidebar-section-head">
            <span className="sidebar-section-title flex-1">{t('common:sidebar.projects')}</span>
            {!showBrand && !showNewChat ? renderSearchTrigger() : null}
            <button
              type="button"
              data-open-project=""
              className="sidebar-section-action"
              onClick={onOpenProject}
              title={openProjectLabel}
              aria-label={openProjectLabel}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.65} />
            </button>
          </div>
          {worktrees.failed && <div role="status" className="px-2 pb-2 text-xs text-foreground-secondary">{t('common:sidebar.worktreeReadFailed')}</div>}
          {diskPaths.length === 0 ? (
            <button
              type="button"
              onClick={onOpenProject}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-left text-[12.5px] text-foreground-secondary transition-colors hover:border-border hover:text-foreground"
            >
              <FolderOpen className="h-4 w-4 shrink-0 opacity-75" strokeWidth={1.6} />
              <span>{t('common:sidebar.openFolderEmpty')}</span>
            </button>
          ) : (
            <div className="space-y-2">
              {projectGroups.map((group) => {
                const projects = group.projects.filter((project) => visiblePaths.includes(project.path))
                if (!projects.length) return null
                if (!group.repositoryPath) return projects.map((project) => renderProject(project, false))
                const name = resolveProjectDisplayName(
                  projectDisplayNames,
                  group.repositoryPath,
                  diskProjectName(group.repositoryPath),
                  { isRepositoryGroup: true },
                )
                const open = searchActive || (repositoryOpen[group.key] ?? group.key === activeRepository)
                const groupPaths = group.projects.map((p) => p.path)
                return (
                  <div key={group.key} className="sidebar-repository-group" role="group" aria-label={name} data-repository={group.repositoryPath}>
                    <div className="group/repo-head relative flex items-center">
                      <button
                        type="button"
                        className="sidebar-repository-hit flex h-[34px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--sidebar-row-hover)]"
                        aria-expanded={open}
                        title={group.repositoryPath}
                        onClick={() => setRepositoryOpen((previous) => ({ ...previous, [group.key]: !open }))}
                        onContextMenu={(event) =>
                          projectMenu.open(event, group.repositoryPath!, name, {
                            isRepositoryGroup: true,
                            repositoryPath: group.repositoryPath!,
                            groupPaths,
                          })
                        }
                      >
                        {open ? (
                          <FolderOpen className="h-[15px] w-[15px] shrink-0 text-foreground-secondary/75" strokeWidth={1.6} />
                        ) : (
                          <Folder className="h-[15px] w-[15px] shrink-0 text-foreground-secondary/75" strokeWidth={1.6} />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">{name}</span>
                        <span
                          className="mr-1 inline-flex shrink-0 items-center justify-center text-[11px] tabular-nums text-foreground-secondary/45 transition-opacity group-hover/repo-head:opacity-0"
                          title={t('common:sidebar.worktreeCount', { count: group.projects.length })}
                        >
                          {group.projects.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        title={t('common:worktrees.newParallel')}
                        aria-label={t('common:worktrees.newParallel')}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (group.repositoryPath && !workspacePathsEqual(currentWorkspace, group.repositoryPath)) {
                            void activateWorkspace(group.repositoryPath).then(() => {
                              usePanelIntentStore.getState().openWorktreesPanel({ expandCreate: true })
                            })
                          } else {
                            usePanelIntentStore.getState().openWorktreesPanel({ expandCreate: true })
                          }
                        }}
                        className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary opacity-0 transition-opacity hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover/repo-head:opacity-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <SidebarAnimatedCollapse open={open}>
                      <div className="pl-3 pt-0.5">
                        {projects.map((project) =>
                          renderProject(
                            project,
                            true,
                            group.repositoryPath,
                            groupPaths.filter((p) => !workspacePathsEqual(p, project.path)),
                          ),
                        )}
                      </div>
                    </SidebarAnimatedCollapse>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Standalone Chats */}
        <div className="mt-5 px-3" hidden={searchActive && visibleSandboxes.length === 0}>
          <div className="sidebar-section-head">
            <button
              type="button"
              onClick={() => setSectionOpen(!sectionOpen)}
              className="sidebar-section-hit flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
              aria-expanded={sectionOpen}
            >
              <span className="sidebar-section-title">
                {t('common:sidebar.conversations')}
              </span>
              <ChevronRight
                className="chevron-expand h-3 w-3 shrink-0 text-foreground-secondary/50"
                data-open={sectionOpen ? 'true' : 'false'}
              />
            </button>
            <button
              type="button"
              onClick={() => void handleNewSandboxDialog()}
              title={t('sidebar.newTempChat')}
              aria-label={t('sidebar.newTempChat')}
              className="sidebar-section-action"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.65} />
            </button>
          </div>
          <SidebarAnimatedCollapse open={searchActive || sectionOpen}>
            <div className="space-y-0.5">
              {ephemeralSandboxDraft && (
                <div className="nav-row nav-row-active relative flex h-[34px] items-center gap-2 rounded-lg px-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {t('sidebar.newChat')}
                  </span>
                </div>
              )}
              {sortedVisibleSandboxes.length === 0 && !ephemeralSandboxDraft ? null : (
                sortedVisibleSandboxes.map((box) => (
                  <SandboxDialogRow
                    key={box.path}
                    box={box}
                    active={box.path === currentWorkspace && !ephemeralSandboxDraft}
                    onOpen={() => void openSandboxDialog(box)}
                    onContextMenu={(e) => sandboxMenu.open(e, box)}
                  />
                ))
              )}
            </div>
          </SidebarAnimatedCollapse>
        </div>
      </OverlayScrollHost>

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
        onListChange={handleProjectListChange}
      />
    </div>
  )
}
