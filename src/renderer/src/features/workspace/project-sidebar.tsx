import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ChevronRight, Archive, FolderOpen, Inbox, Plus } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { toast } from 'sonner'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { SidebarAnimatedCollapse } from '@renderer/components/ui/sidebar-animated-collapse'
import { SandboxContextMenuPortal } from './sandbox-context-menu'
import { useSandboxContextMenu } from './use-sandbox-context-menu'
import { SessionContextMenuPortal } from './session-context-menu'
import { useSessionContextMenu } from './use-session-context-menu'
import { ProjectContextMenuPortal } from './project-context-menu'
import { useProjectContextMenu } from './use-project-context-menu'
import { BatchArchiveDialog } from './batch-archive-dialog'
import {
  ArchivedContextMenuPortal,
  type ArchivedGroupMenu,
  type ArchivedMenuTarget,
} from './archived-context-menu'
import { BatchRestoreDialog } from './batch-restore-dialog'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import {
  diskProjectName,
  isSandboxPath,
  type SandboxEntry,
  type SessionItem,
} from './project-sidebar-types'
import { projectFolderOrder } from './project-folder-order'
import {
  ArchivedSessionEntry,
  ProjectDiskRow,
  ProjectSessionTree,
  SandboxDialogRow,
} from './project-sidebar-rows'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { switchSessionInPlace } from '@renderer/lib/activate-workspace'

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
  const [recentProjectsFixedOrder, setRecentProjectsFixedOrder] = useState(false)
  const fixedOrderRef = useRef(false)
  const [sectionOpen, setSectionOpen] = useState(true)
  const [archivedByWorkspace, setArchivedByWorkspace] = useState<
    Record<string, { open: boolean; loading: boolean; items: SessionItem[] }>
  >({})
  const [sandboxArchived, setSandboxArchived] = useState<{
    open: boolean
    loading: boolean
    items: (SandboxEntry & { archivedAt: number })[]
  }>({ open: false, loading: false, items: [] })

  const [sandboxBatchOpen, setSandboxBatchOpen] = useState(false)
  const [archivedMenu, setArchivedMenu] = useState<{ x: number; y: number; target: ArchivedMenuTarget } | null>(
    null,
  )
  const [archivedGroupMenu, setArchivedGroupMenu] = useState<ArchivedGroupMenu | null>(null)
  const [restoreDialog, setRestoreDialog] = useState<{
    kind: 'project' | 'sandbox'
    workspacePath: string
    sessionFiles: string[]
    title: string
  } | null>(null)

  const loadSandboxArchived = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setSandboxArchived((previous) => ({ ...previous, loading: true }))
    try {
      const res = await ipcClient.invoke('workspace.sandbox.listArchived')
      const items = (res?.sandboxes || []) as (SandboxEntry & { archivedAt: number })[]
      setSandboxArchived((previous) => ({
        open: previous.open || !opts?.silent,
        loading: false,
        items,
      }))
    } catch (e) {
      console.error('[ProjectSidebar] loadSandboxArchived failed:', e)
      if (!opts?.silent) setSandboxArchived((previous) => ({ ...previous, loading: false }))
    }
  }, [])

  const refreshSandboxes = useCallback(() => {
    ipcClient
      .invoke('workspace.sandbox.list')
      .then((r) => setSandboxes(r?.sandboxes || []))
      .catch(() => setSandboxes([]))
    // 归档分组同步静默刷新（不强制展开、不闪 loading）
    void loadSandboxArchived({ silent: true })
  }, [loadSandboxArchived])

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

  const loadArchived = useCallback(async (workspacePath: string, openAfter = false) => {
    if (!workspacePath || isSandboxPath(workspacePath)) return
    setArchivedByWorkspace((previous) => ({
      ...previous,
      [workspacePath]: { ...(previous[workspacePath] || { open: false, items: [] }), loading: true },
    }))
    try {
      const res = await ipcClient.invoke('session.list', { workspaceId: workspacePath, includeArchived: true })
      const items = ((res?.sessions || []) as SessionItem[]).filter((s) => s.archivedAt != null)
      setArchivedByWorkspace((previous) => ({
        ...previous,
        [workspacePath]: {
          open: openAfter || (previous[workspacePath]?.open ?? false),
          loading: false,
          items,
        },
      }))
    } catch (e) {
      console.error('[ProjectSidebar] loadArchived failed:', e)
      setArchivedByWorkspace((previous) => ({
        ...previous,
        [workspacePath]: { ...(previous[workspacePath] || { open: false, items: [] }), loading: false },
      }))
    }
  }, [])

  const refreshSessionsAfterMutation = useCallback(
    (workspacePath?: string) => {
      const targetPath = workspacePath || currentWorkspace
      if (targetPath && !isSandboxPath(targetPath)) {
        void loadWorkspaceSessions(targetPath)
        void loadArchived(targetPath)
        return
      }
      void refreshWorkspaceSessionLists()
    },
    [currentWorkspace, loadWorkspaceSessions, loadArchived],
  )

  const toggleArchived = useCallback(
    (workspacePath: string) => {
      setArchivedByWorkspace((previous) => {
        const current = previous[workspacePath]
        // 收起直接折叠；展开（或从未加载）时总是重新拉取，保证数量/内容新鲜
        if (current?.open) {
          return { ...previous, [workspacePath]: { ...current, open: false } }
        }
        void loadArchived(workspacePath, true)
        return previous
      })
    },
    [loadArchived],
  )

  const refreshArchivedAfterMutation = useCallback((workspacePath: string) => {
    void loadArchived(workspacePath)
  }, [loadArchived])

  const restoreArchived = useCallback(
    async (workspacePath: string, session: SessionItem) => {
      if (!session.sessionFile) return
      try {
        const r = await ipcClient.invoke('session.archive', { sessionFile: session.sessionFile, archived: false })
        if (r?.ok) {
          refreshSessionsAfterMutation(workspacePath)
          refreshArchivedAfterMutation(workspacePath)
        }
      } catch (e) {
        console.error('[ProjectSidebar] restore failed:', e)
      }
    },
    [refreshSessionsAfterMutation, refreshArchivedAfterMutation],
  )

  const deleteArchived = useCallback(
    async (workspacePath: string, session: SessionItem) => {      if (!session.sessionFile) return
      const name = session.title || session.sessionId.slice(0, 8)
      if (!window.confirm(t('common:sidebar.deleteSessionConfirm', { name }))) return
      try {
        const r = await ipcClient.invoke('session.delete', {
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
        })
        if (r?.ok) {
          const cur = useUIStore.getState().currentSessionId
          if (cur === session.sessionId) {
            useUIStore.getState().setCurrentSession('')
            useUIStore.getState().clearTimeline()
            useUIStore.getState().loadHistoryItems([])
            useUIStore.getState().setHistoryMeta(0, 0, null)
            void ipcClient.invoke('session.setPendingBind', { sessionFile: null })
          }
          refreshSessionsAfterMutation(workspacePath)
          refreshArchivedAfterMutation(workspacePath)
        }
      } catch (e) {
        console.error('[ProjectSidebar] delete archived failed:', e)
      }
    },
    [refreshSessionsAfterMutation, refreshArchivedAfterMutation, t],
  )

  const openArchivedSession = useCallback((workspacePath: string, session: SessionItem) => {
    guardSessionSwitch(() => {
      if (workspacePath === useUIStore.getState().currentWorkspace) {
        void switchSessionInPlace(session.sessionId, session.sessionFile)
      } else {
        void activateWorkspace(workspacePath, {
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
        })
      }
    })
  }, [])

  const toggleSandboxArchived = useCallback(() => {
    setSandboxArchived((previous) => {
      if (previous.open) return { ...previous, open: false }
      // 展开时总是重新拉取，保证归档列表新鲜
      void loadSandboxArchived()
      return previous
    })
  }, [loadSandboxArchived])

  const restoreSandboxArchived = useCallback(
    async (box: SandboxEntry & { archivedAt: number }) => {
      const file = box.sessionFile || box.path
      try {
        const r = await ipcClient.invoke('session.archive', { sessionFile: file, archived: false })
        if (r?.ok) {
          refreshSandboxes()
          void loadSandboxArchived({ silent: true })
        }
      } catch (e) {
        console.error('[ProjectSidebar] restore sandbox failed:', e)
      }
    },
    [refreshSandboxes, loadSandboxArchived],
  )

  const deleteSandboxArchived = useCallback(
    async (box: SandboxEntry & { archivedAt: number }) => {
      if (!window.confirm(t('common:sidebar.deleteConfirm', { name: box.label }))) return
      try {
        const r = await ipcClient.invoke('workspace.sandbox.delete', { path: box.path })
        if (r?.ok) {
          refreshSandboxes()
          void loadSandboxArchived({ silent: true })
        }
      } catch (e) {
        console.error('[ProjectSidebar] delete sandbox failed:', e)
      }
    },
    [refreshSandboxes, loadSandboxArchived, t],
  )

  const openArchivedMenu = useCallback(
    (e: React.MouseEvent, s: SessionItem, workspacePath: string) => {
      e.preventDefault()
      e.stopPropagation()
      setArchivedMenu({
        x: e.clientX,
        y: e.clientY,
        target: {
          sessionId: s.sessionId,
          sessionFile: s.sessionFile,
          title: s.title,
          workspacePath,
        },
      })
    },
    [],
  )

  const restoreFromArchivedMenu = useCallback(
    (target: ArchivedMenuTarget) => {
      if (isSandboxPath(target.workspacePath)) {
        const box = sandboxArchived.items.find((b) => (b.sessionId || b.id) === target.sessionId)
        if (box) void restoreSandboxArchived(box)
        return
      }
      const s = archivedByWorkspace[target.workspacePath]?.items.find((x) => x.sessionId === target.sessionId)
      if (s) void restoreArchived(target.workspacePath, s)
    },
    [sandboxArchived.items, archivedByWorkspace, restoreSandboxArchived, restoreArchived],
  )

  const deleteFromArchivedMenu = useCallback(
    (target: ArchivedMenuTarget) => {
      if (isSandboxPath(target.workspacePath)) {
        const box = sandboxArchived.items.find((b) => (b.sessionId || b.id) === target.sessionId)
        if (box) void deleteSandboxArchived(box)
        return
      }
      const s = archivedByWorkspace[target.workspacePath]?.items.find((x) => x.sessionId === target.sessionId)
      if (s) void deleteArchived(target.workspacePath, s)
    },
    [sandboxArchived.items, archivedByWorkspace, deleteSandboxArchived, deleteArchived],
  )

  const restoreArchivedBatch = useCallback(
    (group: ArchivedGroupMenu) => {
      const files =
        group.kind === 'sandbox'
          ? sandboxArchived.items.map((b) => b.sessionFile || b.path).filter((f): f is string => !!f)
          : (archivedByWorkspace[group.workspacePath]?.items || [])
              .map((s) => s.sessionFile)
              .filter((f): f is string => !!f)
      if (files.length === 0) {
        toast.info(t('common:sidebar.batchRestoreNone'))
        return
      }
      setRestoreDialog({
        kind: group.kind,
        workspacePath: group.workspacePath,
        sessionFiles: files,
        title: group.label,
      })
    },
    [sandboxArchived.items, archivedByWorkspace, t],
  )

  const openArchivedGroupMenu = useCallback(
    (e: React.MouseEvent, kind: 'project' | 'sandbox', workspacePath: string, label: string) => {
      e.preventDefault()
      e.stopPropagation()
      setArchivedGroupMenu({ x: e.clientX, y: e.clientY, kind, workspacePath, label })
    },
    [],
  )

  const closeRestoreDialog = useCallback(
    (count: number) => {
      const group = restoreDialog
      setRestoreDialog(null)
      if (count < 0) {
        toast.error(t('common:sidebar.batchRestoreFailed'))
      } else if (count === 0) {
        toast.info(t('common:sidebar.batchRestoreNone'))
      } else {
        toast.success(t('common:sidebar.batchRestored', { count }))
      }
      if (!group) return
      if (group.kind === 'sandbox') {
        refreshSandboxes()
        void loadSandboxArchived({ silent: true })
      } else {
        refreshSessionsAfterMutation(group.workspacePath)
      }
    },
    [restoreDialog, refreshSandboxes, loadSandboxArchived, refreshSessionsAfterMutation, t],
  )

  const openSandboxArchived = useCallback((box: SandboxEntry & { archivedAt: number }) => {
    guardSessionSwitch(() => {
      void activateWorkspace(box.path, {
        sessionId: box.sessionId || undefined,
        sessionFile: box.sessionFile || undefined,
      })
    })
  }, [])


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
        const list = res?.settings?.recentProjects as string[] | undefined
        if (list?.length) {
          const diskOnly = list.filter((p) => !isSandboxPath(p))
          const merged = [...diskOnly]
          if (currentWorkspace && !isSandboxPath(currentWorkspace) && !merged.includes(currentWorkspace)) {
            if (fixedOrderRef.current) merged.push(currentWorkspace)
            else merged.unshift(currentWorkspace)
          }
          const next = [...new Set(merged)].slice(0, 16)
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
        if (previous.has(currentWorkspace)) return previous
        return new Set(previous).add(currentWorkspace)
      })
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

  const diskPaths = useMemo(() => {
    const diskRecent = recentProjects.filter((p) => !isSandboxPath(p))
    const diskCurrent = currentWorkspace && !isSandboxPath(currentWorkspace) ? currentWorkspace : null
    return projectFolderOrder(diskRecent, diskCurrent, recentProjectsFixedOrder)
  }, [recentProjects, currentWorkspace, recentProjectsFixedOrder])

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
        store.setSubagentSessionGroup(null)
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
      // 缓存优先：切换工作区时 setWorkspace 会清空 store.sessions，
      // 若直接覆盖会丢掉目标文件夹已缓存的会话列表（每次都重新“加载中”）。
      // 仅当目标文件夹从未加载过（无缓存键）时才用 store.sessions 兜底。
      if (!(currentWorkspace in next)) {
        next[currentWorkspace] = sessions
      }
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
          {sandboxes.length > 0 && (
            <button
              type="button"
              onClick={() => setSandboxBatchOpen(true)}
              title={t('common:sidebar.batchArchiveSandbox')}
              className="chrome-icon-btn shrink-0 cursor-pointer rounded-md p-1.5"
            >
              <Archive className="h-4 w-4" />
            </button>
          )}
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
                  onContextMenu={(e) => sandboxMenu.open(e, box.path, box.label, box.sessionFile)}
                />
              ))
            )}
            <ArchivedSessionEntry
              archived={sandboxArchived.items.map((b) => ({
                sessionId: b.sessionId || b.id,
                sessionFile: b.sessionFile || '',
                title: b.label,
                createdAt: b.createdAt,
                updatedAt: 0,
                messageCount: 0,
                modelId: '',
                status: 'idle' as const,
                workspaceId: b.path,
                workspacePath: b.path,
                archivedAt: b.archivedAt,
              }))}
              loading={sandboxArchived.loading}
              open={sandboxArchived.open}
              onToggle={toggleSandboxArchived}
              onContextMenu={(e, s) => openArchivedMenu(e, s, s.workspacePath || '')}
              onHeaderContextMenu={(e) => {
                if (sandboxArchived.items.length === 0) return
                openArchivedGroupMenu(e, 'sandbox', '', t('common:sidebar.tempChat'))
              }}
              onRestore={(s) => {
                const box = sandboxArchived.items.find((b) => (b.sessionId || b.id) === s.sessionId)
                if (box) void restoreSandboxArchived(box)
              }}
              onDelete={(s) => {
                const box = sandboxArchived.items.find((b) => (b.sessionId || b.id) === s.sessionId)
                if (box) void deleteSandboxArchived(box)
              }}
              onOpen={(s) => {
                const box = sandboxArchived.items.find((b) => (b.sessionId || b.id) === s.sessionId)
                if (box) openSandboxArchived(box)
              }}
            />
          </div>
        </SidebarAnimatedCollapse>
      </div>

      <ArchivedContextMenuPortal
        menu={archivedMenu}
        groupMenu={archivedGroupMenu}
        onClose={() => {
          setArchivedMenu(null)
          setArchivedGroupMenu(null)
        }}
        onRestore={restoreFromArchivedMenu}
        onDelete={deleteFromArchivedMenu}
        onBatchRestore={restoreArchivedBatch}
      />
      <SandboxContextMenuPortal menu={sandboxMenu.menu} onClose={sandboxMenu.close} onListChange={refreshSandboxes} />
      <BatchArchiveDialog
        open={sandboxBatchOpen}
        workspacePath=""
        sandbox
        onCancel={() => setSandboxBatchOpen(false)}
        onDone={(count) => {
          setSandboxBatchOpen(false)
          if (count < 0) {
            toast.error(t('common:sidebar.archiveFailed'))
          } else if (count === 0) {
            toast.info(t('common:sidebar.batchArchiveNone'))
          } else {
            toast.success(t('common:sidebar.batchArchived', { count }))
          }
          refreshSandboxes()
        }}
      />
      <BatchRestoreDialog
        open={!!restoreDialog}
        title={restoreDialog?.title || ''}
        sessionFiles={restoreDialog?.sessionFiles || []}
        onCancel={() => setRestoreDialog(null)}
        onDone={closeRestoreDialog}
      />
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
                  // 展开时同步已归档数量，让「已归档」入口可见并可展开
                  if (willExpand) void loadArchived(path)
                }}
                onNewSession={() => void handleNewSessionInProject(path)}
                onProjectContextMenu={(e) =>
                  projectMenu.open(e, path, diskProjectName(path), projectSessions.length > 0)
                }
                sessionTree={
                  <>
                    <ProjectSessionTree
                      workspacePath={path}
                      projectSessions={projectSessions}
                      loading={loading}
                      currentWorkspace={currentWorkspace}
                      currentSessionId={currentSessionId}
                      onSessionContextMenu={(e, payload) => sessionMenu.open(e, payload)}
                    />
                    <ArchivedSessionEntry
                      archived={archivedByWorkspace[path]?.items || []}
                      loading={!!archivedByWorkspace[path]?.loading}
                      open={!!archivedByWorkspace[path]?.open}
                      onToggle={() => toggleArchived(path)}
                      onContextMenu={(e, s) => openArchivedMenu(e, s, path)}
                      onHeaderContextMenu={(e) => {
                        if ((archivedByWorkspace[path]?.items.length || 0) === 0) return
                        openArchivedGroupMenu(e, 'project', path, diskProjectName(path))
                      }}
                      onRestore={(s) => void restoreArchived(path, s)}
                      onDelete={(s) => void deleteArchived(path, s)}
                      onOpen={(s) => openArchivedSession(path, s)}
                    />
                  </>
                }
              />
            )
          })
        )}
      </div>
    </div>
  )
}
