import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { hydrateBackgroundFromSettings } from '@renderer/lib/theme/background-layer'
import { ErrorBoundary } from '@renderer/components/app/error-boundary'
import { MainLayoutShell } from '@renderer/components/app/main-layout-shell'
import { Sidebar, SidebarContent, SidebarItem, RightPanel } from '@renderer/components/ui/sidebar'
import { ProjectSidebar } from '@renderer/features/workspace/project-sidebar'
import { SidebarActiveSessionsDrawer } from '@renderer/features/workspace/sidebar-active-sessions-drawer'
import { MainColRightPanelToggle } from '@renderer/components/app/main-col-right-panel-toggle'
import { MainColumnWithTimelineScroll } from '@renderer/components/app/main-column-with-timeline-scroll'
import { ComposerDock } from '@renderer/components/app/composer-dock'
import { TimelineScrubber } from '@renderer/features/timeline/timeline-scrubber'
import { SplitView } from '@renderer/features/split/split-view'
import { Timeline } from '@renderer/features/timeline/timeline'
import { Composer } from '@renderer/features/composer/composer'

import { TopBar } from '@renderer/components/app/top-bar'
import { ImmersiveChrome } from '@renderer/components/app/immersive-chrome'
import { useUIStore } from '@renderer/stores/ui-store'
import { onAppEvent, onWorkerExit, onNotificationOpenSession, ipcClient } from '@renderer/lib/ipc-client'
import { handleNotificationOpenSession } from '@renderer/lib/notification-open-session'
import { requestTimelineViewEntry } from '@renderer/features/timeline/timeline-view-jump'

import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { resolveProjectDisplayName } from '@shared/workspace-path'
import { ensureWorkspaceWorkerOnBoot } from '@renderer/lib/ensure-workspace-worker'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useTranslation } from 'react-i18next'
import { FolderGit2, GitFork, Globe, Settings as SettingsIcon } from '@renderer/components/icons'
import { useBrowserStore } from '@renderer/features/browser/browser-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { cn } from '@renderer/lib/utils'
import { buildRightPanelTabs } from '@renderer/lib/right-panel-catalog'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { isRightPanelHidden } from '@renderer/lib/right-panel-visibility'
import { RightDock } from '@renderer/features/shell/right-dock'
import { isPanelVisibleInRightDock, useRightDockStore } from '@renderer/stores/right-dock-store'
import { loadNormalizedRightPanelPrefs } from '@renderer/lib/right-panel-runtime'
import {
  normalizeTimelineMaxAutoExpandedTools,
  normalizeTimelineUserMessageStyle,
  normalizeTimelineVisibleTurns,
} from '@shared/timeline-settings'
import { normalizeUiCustomization } from '@shared/ui-customization'
import { applyUserMessageStyleToDocument } from '@renderer/features/settings/settings-draft'
import { applyUiCustomizationToDocument } from '@renderer/lib/theme/apply-ui-customization'
import { usePanelNavigationSuppression } from '@renderer/lib/panel-animation-guard'

import { ExtensionUIHost } from '@renderer/features/extension-ui/extension-ui-host'
import { AppToaster } from '@renderer/components/app/app-toaster'
import { markExtensionNotifyAppReady } from '@renderer/lib/extension-notify-policy'
import {
  hydrateCustomCssOverrideFromSettings,
  hydrateCustomThemeFromSettings,
  hydrateThemeFromSettings,
  watchSystemTheme,
} from '@renderer/features/settings/settings-draft'
import { hydrateSnippetsFromDisk } from '@renderer/lib/theme/render-fx-engine'
import { CommandPalette, ShortcutsHelpSheet } from '@renderer/features/shell/command-palette'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { AppUpdateHost } from '@renderer/lib/app-update-notify'
import { CloseDecisionDialog } from '@renderer/components/ui/close-decision-dialog'
import { StatusBar } from '@renderer/features/shell/status-bar'
import { clearExitedSessionRuntime } from '@renderer/lib/worker-exit-runtime'
import { handleSdkRuntimeChanged } from '@renderer/lib/sdk-runtime-changed'
import { prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import { activateAdapterWorkspace, invalidateAdapterSnapshots, revalidateActiveAdapterCatalog } from '@renderer/lib/adapter-catalog'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'

import { useDoubleEscapeTree } from '@renderer/hooks/use-double-escape-tree'
import { useReviewGitData } from '@renderer/features/review/use-review-git-data'
import { applyUiZoom, readUiZoom } from '@renderer/lib/ui-zoom'
import { matchShortcut, readShortcutBindings } from '@renderer/lib/shortcut-bindings'
import { TerminalDrawer, useTerminalShortcut } from '@renderer/features/terminal/terminal-drawer'
import { useBrowserHelpAttention } from '@renderer/features/browser/use-help-attention'
import { HelpBar } from '@renderer/features/browser/help-bar'
import { useTerminalStore } from '@renderer/features/terminal/terminal-store'
import type { ForkSource } from '@renderer/lib/session-fork'

type View = 'main' | 'settings'

const SettingsPage = lazy(() =>
  import('@renderer/features/settings/settings-page').then((m) => ({ default: m.SettingsPage })),
)

const ModelPicker = lazy(() =>
  import('@renderer/features/composer/model-picker').then((m) => ({ default: m.ModelPicker })),
)
const ThinkingPicker = lazy(() =>
  import('@renderer/features/composer/thinking-picker').then((m) => ({ default: m.ThinkingPicker })),
)
const SessionTreeOverlay = lazy(() =>
  import('@renderer/features/rewind/session-tree-overlay').then((m) => ({ default: m.SessionTreeOverlay })),
)
const SessionForkOverlay = lazy(() =>
  import('@renderer/features/rewind/session-fork-overlay').then((m) => ({ default: m.SessionForkOverlay })),
)
const LiveThemeStudio = lazy(() =>
  import('@renderer/features/shell/live-theme-studio').then((m) => ({ default: m.LiveThemeStudio })),
)
const ProjectHomeView = lazy(() =>
  import('@renderer/components/app/project-home-view').then((m) => ({ default: m.ProjectHomeView })),
)

function ShellSuspenseFallback({ label }: { label: string }) {
  return <EmptyState compact title={label} className="min-h-[12rem]" />
}

if ((window as unknown as { piDesktop?: { e2e?: boolean } }).piDesktop?.e2e) {
  ;(window as unknown as { __piE2E?: unknown }).__piE2E = { useUIStore, useExtensionUIStore, ipcClient }
}

performance.mark('pi:app-module')

export default function App() {
  if (!performance.getEntriesByName('pi:app-render').length) performance.mark('pi:app-render')
  const { t } = useTranslation()
  const [view, setView] = useState<View>('main')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioSeedTheme, setStudioSeedTheme] = useState<import('@shared/custom-theme').CustomTheme | undefined>(undefined)
  const activePanel = useUIStore((s) => s.activePanel)
  const rightPanelHidden = useRightPanelHidden()
  const dockBottomTabs = useRightDockStore((s) => s.bottomTabIds)
  const dockTopActive = useRightDockStore((s) => s.topActive)
  const dockBottomActive = useRightDockStore((s) => s.bottomActive)
  const browserTabCount = useBrowserStore((s) => s.order.length)
  const browserAgentBusy = useBrowserStore((s) => Boolean(s.agentAction))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = window.piDesktop?.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const hidden = isRightPanelHidden({
          collapsed: useUIStore.getState().rightPanelCollapsed,
          expandedOnNarrow: useUIStore.getState().rightPanelExpandedOnNarrow,
          windowWidth: window.innerWidth,
        })
        usePanelIntentStore.getState().toggleRightPanelTab('browser', !hidden)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const modelPickerOpen = useUIStore((s) => s.modelPickerOpen)
  const thinkingPickerOpen = useUIStore((s) => s.thinkingPickerOpen)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const rightPanelPrefs = useUIStore((s) => s.rightPanelPrefs)
  const rightPanelOrder = useUIStore((s) => s.rightPanelOrder)
  const applyRightPanelRuntime = useUIStore((s) => s.applyRightPanelRuntime)
  const browserPanelEnabled = !!rightPanelPrefs.browser
  useBrowserHelpAttention(browserPanelEnabled)
  const browserWasEnabled = useRef(browserPanelEnabled)
  useEffect(() => {
    // Turning the experimental browser panel off releases every tab in Main.
    if (browserWasEnabled.current && !browserPanelEnabled) void ipcClient.invoke('browser.shutdown').catch(() => {})
    browserWasEnabled.current = browserPanelEnabled
  }, [browserPanelEnabled])
  const rightPanelCatalog = useUIStore((s) => s.rightPanelCatalog)
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const projectDisplayNames = useUIStore((s) => s.projectDisplayNames)
  const terminalOpen = useTerminalStore((s) => s.open)
  const terminalHeight = useTerminalStore((s) => s.height)
  useTerminalShortcut()
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const [workspaceTitle, setWorkspaceTitle] = useState<string | undefined>()
  const canUseTree = view === 'main' && (!!currentWorkspace || ephemeralSandboxDraft)
  const { treeOpen, setTreeOpen, forkOpen, setForkOpen } = useDoubleEscapeTree(canUseTree)
  const [forkSource, setForkSource] = useState<ForkSource | undefined>()

  useEffect(() => {
    if (ephemeralSandboxDraft) {
      setWorkspaceTitle(t('common:home.newChat'))
      return
    }
    if (!currentWorkspace) {
      setWorkspaceTitle(undefined)
      return
    }
    const norm = currentWorkspace.replace(/\\/g, '/')
    if (!norm.includes('sandbox-workspaces/')) {
      const fallback = currentWorkspace.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || currentWorkspace
      setWorkspaceTitle(resolveProjectDisplayName(projectDisplayNames, currentWorkspace, fallback))
      return
    }
    ipcClient
      .invoke('workspace.sandbox.list')
      .then((r) => {
        const box = (r?.sandboxes || []).find((b: { path: string }) => b.path === currentWorkspace)
        setWorkspaceTitle(box?.label || t('common:sidebar.tempChat'))
      })
      .catch(() => setWorkspaceTitle(t('common:sidebar.tempChat')))
  }, [currentWorkspace, ephemeralSandboxDraft, projectDisplayNames, t])

  const projectName = workspaceTitle

  useEffect(() => {
    const onOpenFork = (event: Event) => {
      setForkSource((event as CustomEvent<{ source?: ForkSource } | undefined>).detail?.source)
      setForkOpen(true)
    }
    window.addEventListener('pi-desktop:open-fork-selector', onOpenFork)
    return () => window.removeEventListener('pi-desktop:open-fork-selector', onOpenFork)
  }, [setForkOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const bindings = readShortcutBindings()
      if (matchShortcut(event, bindings.commandPalette)) {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (matchShortcut(event, bindings.shortcuts)) {
        event.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    markExtensionNotifyAppReady()
    useExtensionUIStore.getState().resetForSessionContext()
    void ensureWorkspaceWorkerOnBoot()
    void hydrateThemeFromSettings().catch(() => {})
    void hydrateCustomThemeFromSettings().catch(() => {})
    void hydrateCustomCssOverrideFromSettings().catch(() => {})
    void hydrateSnippetsFromDisk().catch(() => {})
    void hydrateBackgroundFromSettings().catch(() => {})
    applyUiZoom(readUiZoom())
  }, [])

  useEffect(() => watchSystemTheme(), [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadNormalizedRightPanelPrefs()
        .then(({ catalog, prefs, order }) => applyRightPanelRuntime(catalog, prefs, order))
        .catch(() => {})
      void ipcClient
        .invoke('settings.get', { key: 'timelineMaxAutoExpandedTools' })
        .then((res) => {
          const raw = res?.settings?.timelineMaxAutoExpandedTools
          useUIStore
            .getState()
            .setTimelineMaxAutoExpandedTools(normalizeTimelineMaxAutoExpandedTools(raw))
        })
        .catch(() => {})
      void ipcClient
        .invoke('settings.get', { key: 'timelineVisibleTurns' })
        .then((res) => {
          useUIStore.getState().setTimelineVisibleTurns(normalizeTimelineVisibleTurns(res?.settings?.timelineVisibleTurns))
        })
        .catch(() => {})
      void ipcClient
        .invoke('settings.get', { key: 'timelineUserMessageStyle' })
        .then((res) => {
          const style = normalizeTimelineUserMessageStyle(res?.settings?.timelineUserMessageStyle)
          useUIStore.getState().setTimelineUserMessageStyle(style)
          applyUserMessageStyleToDocument(style)
        })
        .catch(() => {})
      void ipcClient
        .invoke('settings.get', { key: 'uiCustomization' })
        .then((res) => {
          const cfg = normalizeUiCustomization(res?.settings?.uiCustomization)
          useUIStore.getState().setUiCustomization(cfg)
          applyUiCustomizationToDocument(cfg)
        })
        .catch(() => {})
      prefetchAvailableModels()
      // The composer menus open from a chip click; load their code ahead so the first open is instant.
      window.setTimeout(() => {
        void import('@renderer/features/composer/model-picker')
        void import('@renderer/features/composer/thinking-picker')
      }, 1500)
    })
    return () => cancelAnimationFrame(frame)
  }, [applyRightPanelRuntime])

  useEffect(() => {
    activateAdapterWorkspace(currentWorkspace)
    invalidateRightPanelCatalog()
    let active = true
    void loadNormalizedRightPanelPrefs().then(({ catalog, prefs, order }) => {
      if (active) applyRightPanelRuntime(catalog, prefs, order)
    }).catch(() => {})
    return () => { active = false }
  }, [currentWorkspace, applyRightPanelRuntime])

  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') void revalidateActiveAdapterCatalog().catch(() => {}) }
    window.addEventListener('focus', check)
    const timer = window.setInterval(check, 5000)
    return () => { window.removeEventListener('focus', check); window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    const unsubEvents = onAppEvent((event) => {
      if (event.type === 'sdk-runtime-changed' || event.type === 'adapter-catalog-changed') {
        invalidateAdapterSnapshots()
        invalidateRightPanelCatalog()
        const workspace = useUIStore.getState().currentWorkspace
        void loadNormalizedRightPanelPrefs().then(({ catalog, prefs, order }) => {
          if (useUIStore.getState().currentWorkspace === workspace) useUIStore.getState().applyRightPanelRuntime(catalog, prefs, order)
        }).catch(() => {})
        if (event.type === 'sdk-runtime-changed') void handleSdkRuntimeChanged()
        return
      }
      if (event.type === 'remote-settings-changed') {
        if (event.key === 'capabilities') void import('@renderer/lib/session-capabilities').then((m) => m.reloadSessionCapabilities())
        if (event.key === 'purge') void import('@renderer/lib/agent-purge-store').then((m) => m.loadAgentPurgeState(true))
        if (event.key === 'rewound' && event.sessionFile) {
          // A phone rewound a session: if it is on screen, rebuild it from disk on the new branch.
          const rewound = event.sessionFile
          void import('@renderer/lib/session-file-key').then(({ sessionFilesEqual }) => {
            if (!sessionFilesEqual(useUIStore.getState().historySessionFile, rewound)) return
            void import('@renderer/lib/reload-current-session-data').then((m) => m.reloadCurrentSessionData())
          })
        }
        if (event.key === 'sessions' && event.workspaceId) {
          const workspaceIds = [event.workspaceId]
          void import('@renderer/lib/refresh-workspace-session-lists').then((m) => m.refreshWorkspaceSessionLists({ workspaceIds }))
        }
        return
      }
      useUIStore.getState().processEvent(event)
    })
    void import('@renderer/lib/session-worker-sync').then(({ fetchWorkerLiveSnapshot }) => {
      fetchWorkerLiveSnapshot()
        .then((snap) => useUIStore.getState().setWorkerLiveSnapshot(snap))
        .catch(() => {})
    })
    const unsubExit = onWorkerExit((info) => {
      console.warn('Worker exited:', info)
      const store = useUIStore.getState()
      clearExitedSessionRuntime(
        info,
        store.setSessionRuntimeRunning,
        store.setCompactingSession,
      )
      if (info.sessionFile) store.setRetryingSession(info.sessionFile, null)
    })
    const unsubNotify = onNotificationOpenSession((payload) => {
      void handleNotificationOpenSession(payload)
    })
    // Settings → Usage: a session row or request log opens that session (and optionally scrolls to entryId).
    const onOpenSession = (e: Event) => {
      const d = (e as CustomEvent<{ workspaceId?: string; sessionFile?: string; entryId?: string }>).detail
      setView('main')
      void handleNotificationOpenSession({ ok: true, workspaceId: d?.workspaceId, sessionFile: d?.sessionFile }).then(
        () => {
          if (d?.entryId && !d.entryId.startsWith('@line:')) {
            requestTimelineViewEntry(d.entryId)
          }
        },
      )
    }
    const onOpenSettingsPage = () => setView('settings')
    const onOpenLiveStudio = (e: Event) => {
      const d = (e as CustomEvent<{ theme?: import('@shared/custom-theme').CustomTheme }>).detail
      setStudioSeedTheme(d?.theme)
      setView('main')
      setStudioOpen(true)
    }
    window.addEventListener('pi-desktop:open-session', onOpenSession)
    window.addEventListener('pi-desktop:open-settings-page', onOpenSettingsPage)
    window.addEventListener('pi-desktop:open-live-theme-studio', onOpenLiveStudio)
    return () => {
      window.removeEventListener('pi-desktop:open-session', onOpenSession)
      window.removeEventListener('pi-desktop:open-settings-page', onOpenSettingsPage)
      window.removeEventListener('pi-desktop:open-live-theme-studio', onOpenLiveStudio)
      unsubEvents()
      unsubExit()
      unsubNotify()
    }
  }, [setWorkspace])

  useEffect(() => {
    if (pendingExtensionConfig) {
      setView('settings')
    }
  }, [pendingExtensionConfig])

  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const timelineItemCount = useUIStore((s) => s.timelineItems.length)
  const historyLoading = useUIStore((s) => s.historyLoading)

  const handleOpenProject = async () => {
    if (!window.piDesktop) {
      console.error('piDesktop not available')
      return
    }
    try {
      const res = await window.piDesktop.invoke('ipc:dialog:openDirectory')
      if (res?.path) {
        await activateWorkspace(res.path, { preferHome: true })
      }
    } catch (e) {
      console.error('[App] Failed to open project:', e)
    }
  }

  const recentProjects = useUIStore((s) => s.recentProjects)
  const fileChanges = useUIStore((s) => s.fileChanges)
  const { gitData } = useReviewGitData({
    enabled: !!currentWorkspace,
    workspace: currentWorkspace,
    worktreeChangeSignal: fileChanges,
  })
  const panelPrefs =
    gitData?.isRepo === false ? { ...rightPanelPrefs, review: false } : rightPanelPrefs
  const navSuppressed = usePanelNavigationSuppression(`${currentWorkspace || ''}::${historySessionFile || ''}`)
  const PANELS = buildRightPanelTabs(rightPanelCatalog, panelPrefs, t, rightPanelOrder)
  // Subscribe to dock slices so sidebar footer highlights update immediately on split/tab switch
  void dockBottomTabs
  void dockTopActive
  void dockBottomActive

  const isHomeMode =
    !currentSessionId && timelineItemCount === 0 && !ephemeralSandboxDraft && !historyLoading
  const showHome = (isHomeMode || ephemeralSandboxDraft) && view === 'main'

  const handleSelectProject = async (path: string) => {
    await activateWorkspace(path, { preferHome: true })
  }

  const paletteAndShortcuts = (
    <>
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenSettings={() => setView('settings')}
        onOpenSessionTree={canUseTree ? () => setTreeOpen(true) : undefined}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsHelpSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  )

  if (view === 'settings') {
    return (
      <ErrorBoundary>
        <div
          className="app-viewport flex flex-col overflow-hidden text-foreground"
          style={{ background: 'var(--surface-sidebar)' }}
        >
          <TopBar
            onBack={() => {
              useUIStore.getState().requestExtensionConfig(null)
              setView('main')
              void refreshComposerRunDisplay()
            }}
            title={t('settings:title')}
          />
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <ErrorBoundary label="settings">
              <Suspense fallback={<ShellSuspenseFallback label={t('common:loadingSettings')} />}>
                <SettingsPage />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
        {paletteAndShortcuts}
        <AppUpdateHost />
        <CloseDecisionDialog />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div
        className="app-viewport flex flex-col overflow-hidden text-foreground"
        style={{ background: 'var(--surface-sidebar)' }}
      >
        <ImmersiveChrome projectName={projectName} />
        <MainLayoutShell
          left={
            <Sidebar>
              <SidebarContent>
                <ProjectSidebar
                  onOpenProject={handleOpenProject}
                  openProjectLabel={t('sidebar.openProject')}
                />
              </SidebarContent>
              <SidebarActiveSessionsDrawer />
              <div className="flex h-10 shrink-0 items-center gap-0.5 border-t border-border/35 px-2">
                <button
                  type="button"
                  onClick={() => setView('settings')}
                  className="nav-row flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-foreground-secondary transition-colors hover:text-foreground"
                >
                  <SettingsIcon className="h-[15px] w-[15px] shrink-0 opacity-80" strokeWidth={1.65} />
                  <span className="sidebar-label-fade truncate">{t('sidebar.settings')}</span>
                </button>
                {currentWorkspace && !ephemeralSandboxDraft ? (
                  <>
                    <button
                      type="button"
                      title={t('common:panel.worktrees')}
                      aria-label={t('common:panel.worktrees')}
                      aria-pressed={!rightPanelHidden && isPanelVisibleInRightDock('worktrees')}
                      onClick={() =>
                        usePanelIntentStore.getState().toggleRightPanelTab('worktrees', !rightPanelHidden)
                      }
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground',
                        !rightPanelHidden &&
                          isPanelVisibleInRightDock('worktrees') &&
                          'bg-[var(--bg-active)] text-foreground',
                      )}
                    >
                      <FolderGit2 className="h-[15px] w-[15px]" strokeWidth={1.65} />
                    </button>
                    <button
                      type="button"
                      title={t('common:panel.github')}
                      aria-label={t('common:panel.github')}
                      aria-pressed={!rightPanelHidden && isPanelVisibleInRightDock('github')}
                      onClick={() =>
                        usePanelIntentStore.getState().toggleRightPanelTab('github', !rightPanelHidden)
                      }
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground',
                        !rightPanelHidden &&
                          isPanelVisibleInRightDock('github') &&
                          'bg-[var(--bg-active)] text-foreground',
                      )}
                    >
                      <GitFork className="h-[15px] w-[15px]" strokeWidth={1.65} />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  data-pi-slot="sidebar-browser-toggle"
                  title={
                    browserTabCount > 0
                      ? `${t('browser:stage.toggleTooltip')} (${browserTabCount})`
                      : t('browser:stage.toggleTooltip')
                  }
                  aria-label={t('browser:stage.toggleTooltip')}
                  aria-pressed={!rightPanelHidden && isPanelVisibleInRightDock('browser')}
                  onClick={() =>
                    usePanelIntentStore.getState().toggleRightPanelTab('browser', !rightPanelHidden)
                  }
                  className={cn(
                    'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground',
                    !rightPanelHidden &&
                      isPanelVisibleInRightDock('browser') &&
                      'bg-[var(--bg-active)] text-foreground',
                  )}
                >
                  <Globe className="h-[15px] w-[15px]" strokeWidth={1.65} />
                  {browserTabCount > 0 || browserAgentBusy ? (
                    <span
                      className={cn(
                        'absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--brand)]',
                        browserAgentBusy && 'animate-pulse',
                      )}
                      aria-hidden
                    />
                  ) : null}
                </button>
              </div>
            </Sidebar>
          }
          center={
            <SplitView>
            <MainColumnWithTimelineScroll className="h-full">
              {showHome ? (
                <Suspense fallback={<ShellSuspenseFallback label={t('common:loading')} />}>
                  <ProjectHomeView
                    projectName={ephemeralSandboxDraft ? t('common:home.newChat') : projectName}
                    subtitle={
                      ephemeralSandboxDraft ? t('common:home.firstMsgIsTitle') : undefined
                    }
                    recentProjects={recentProjects}
                    currentWorkspace={currentWorkspace}
                    ephemeralSandboxDraft={ephemeralSandboxDraft}
                    onSelectProject={(p) => void handleSelectProject(p)}
                    onOpenProject={handleOpenProject}
                  />
                </Suspense>
              ) : (
                <Timeline />
              )}
              <MainColRightPanelToggle />
              <ComposerDock heroMode={showHome}>
                {/* The agent waiting on the user in their Chrome: answerable right above the composer. */}
                <HelpBar activeTabId={null} where="chrome" className="mb-2 rounded-lg border" />
                <Composer />
              </ComposerDock>
              {!showHome ? <TimelineScrubber /> : null}
            </MainColumnWithTimelineScroll>
            </SplitView>
          }
          right={
            <RightPanel>
              <RightDock
                panels={PANELS}
                catalog={rightPanelCatalog}
                rightPanelHidden={rightPanelHidden}
                navSuppressed={navSuppressed}
              />
            </RightPanel>
          }
          bottom={<TerminalDrawer />}
          bottomOpen={terminalOpen}
          bottomHeight={terminalHeight}
        />
        <StatusBar />
      </div>
      <AppToaster />
      <ExtensionUIHost />
      <AppUpdateHost />
      <CloseDecisionDialog />
      {paletteAndShortcuts}
      <Suspense fallback={null}>
        {modelPickerOpen && <ModelPicker />}
        {thinkingPickerOpen && <ThinkingPicker />}
        {treeOpen && <SessionTreeOverlay open={treeOpen} onClose={() => setTreeOpen(false)} />}
        {forkOpen && (
          <SessionForkOverlay
            open={forkOpen}
            source={forkSource}
            onClose={() => {
              setForkOpen(false)
              setForkSource(undefined)
            }}
          />
        )}
        {studioOpen && (
          <LiveThemeStudio
            open={studioOpen}
            initialTheme={studioSeedTheme}
            onClose={() => setStudioOpen(false)}
          />
        )}
      </Suspense>
    </ErrorBoundary>
  )
}
