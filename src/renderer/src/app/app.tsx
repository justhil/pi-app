import { lazy, Suspense, useEffect, useState } from 'react'
import { ErrorBoundary } from '@renderer/components/app/error-boundary'
import { MainLayoutShell } from '@renderer/components/app/main-layout-shell'
import { Sidebar, SidebarContent, SidebarItem, RightPanel } from '@renderer/components/ui/sidebar'
import { ProjectSidebar } from '@renderer/features/workspace/project-sidebar'
import { MainColRightPanelToggle } from '@renderer/components/app/main-col-right-panel-toggle'
import { MainColumnWithTimelineScroll } from '@renderer/components/app/main-column-with-timeline-scroll'
import { ComposerDock } from '@renderer/components/app/composer-dock'
import { ChatTimelineProgressRail } from '@renderer/features/timeline/chat-timeline-progress-rail'
import { Timeline } from '@renderer/features/timeline/timeline'
import { Composer } from '@renderer/features/composer/composer'

import { TopBar } from '@renderer/components/app/top-bar'
import { ImmersiveChrome } from '@renderer/components/app/immersive-chrome'
import { useUIStore } from '@renderer/stores/ui-store'
import { onAppEvent, onWorkerExit, ipcClient } from '@renderer/lib/ipc-client'

import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { ensureWorkspaceWorkerOnBoot } from '@renderer/lib/ensure-workspace-worker'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon } from 'lucide-react'
import { buildRightPanelTabs } from '@renderer/lib/right-panel-catalog'
import { RightPanelTabs } from '@renderer/features/shell/right-panel-tabs'
import { loadNormalizedRightPanelPrefs } from '@renderer/lib/right-panel-runtime'
import { normalizeTimelineMaxAutoExpandedTools } from '@shared/timeline-settings'
import { SidePanelHost } from '@renderer/features/side-panels/side-panel-host'
import { ExtensionUIHost } from '@renderer/features/extension-ui/extension-ui-host'
import { AppToaster } from '@renderer/components/app/app-toaster'
import { markExtensionNotifyAppReady } from '@renderer/lib/extension-notify-policy'
import { hydrateThemeFromSettings } from '@renderer/features/settings/settings-draft'
import { CommandPalette, ShortcutsHelpSheet } from '@renderer/features/shell/command-palette'
import { EmptyState } from '@renderer/components/ui/empty-state'

import { useDoubleEscapeTree } from '@renderer/hooks/use-double-escape-tree'

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
const ProjectHomeView = lazy(() =>
  import('@renderer/components/app/project-home-view').then((m) => ({ default: m.ProjectHomeView })),
)

function ShellSuspenseFallback({ label }: { label: string }) {
  return <EmptyState compact title={label} className="min-h-[12rem]" />
}

export default function App() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('main')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const activePanel = useUIStore((s) => s.activePanel)
  const rightPanelCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const modelPickerOpen = useUIStore((s) => s.modelPickerOpen)
  const thinkingPickerOpen = useUIStore((s) => s.thinkingPickerOpen)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const rightPanelPrefs = useUIStore((s) => s.rightPanelPrefs)
  const rightPanelOrder = useUIStore((s) => s.rightPanelOrder)
  const applyRightPanelRuntime = useUIStore((s) => s.applyRightPanelRuntime)
  const rightPanelCatalog = useUIStore((s) => s.rightPanelCatalog)
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setSessions = useUIStore((s) => s.setSessions)
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const [workspaceTitle, setWorkspaceTitle] = useState<string | undefined>()
  const canUseTree = view === 'main' && (!!currentWorkspace || ephemeralSandboxDraft)
  const { treeOpen, setTreeOpen, forkOpen, setForkOpen } = useDoubleEscapeTree(canUseTree)

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
      setWorkspaceTitle(currentWorkspace.split(/[\\/]/).pop())
      return
    }
    ipcClient
      .invoke('workspace.sandbox.list')
      .then((r) => {
        const box = (r?.sandboxes || []).find((b: { path: string }) => b.path === currentWorkspace)
        setWorkspaceTitle(box?.label || t('common:sidebar.tempChat'))
      })
      .catch(() => setWorkspaceTitle(t('common:sidebar.tempChat')))
  }, [currentWorkspace, ephemeralSandboxDraft, t])

  const projectName = workspaceTitle

  useEffect(() => {
    const onOpenFork = () => setForkOpen(true)
    window.addEventListener('pi-desktop:open-fork-selector', onOpenFork)
    return () => window.removeEventListener('pi-desktop:open-fork-selector', onOpenFork)
  }, [setForkOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const mod = event.metaKey || event.ctrlKey
      if (mod && key === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (mod && key === '/') {
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
  }, [])

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
    })
    return () => cancelAnimationFrame(frame)
  }, [applyRightPanelRuntime])

  useEffect(() => {
    const unsubEvents = onAppEvent((event) => useUIStore.getState().processEvent(event))
    void import('@renderer/lib/session-worker-sync').then(({ fetchWorkerLiveSnapshot }) => {
      fetchWorkerLiveSnapshot()
        .then((snap) => useUIStore.getState().setWorkerLiveSnapshot(snap))
        .catch(() => {})
    })
    const unsubExit = onWorkerExit((info) => {
      console.warn('Worker exited:', info)
    })
    return () => {
      unsubEvents()
      unsubExit()
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

  useEffect(() => {
    if (!currentWorkspace) return
    ipcClient
      .invoke('session.list', { workspaceId: currentWorkspace })
      .then((res) => {
        if (res?.sessions) setSessions(res.sessions)
      })
      .catch(() => {})
  }, [currentWorkspace, setSessions])

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
  const PANELS = buildRightPanelTabs(rightPanelCatalog, rightPanelPrefs, t, rightPanelOrder)
  const activeCatalogItem = rightPanelCatalog.find((c) => c.id === activePanel)

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
          className="flex h-screen flex-col overflow-hidden text-foreground"
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
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div
        className="flex h-screen flex-col overflow-hidden text-foreground"
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
              <div className="border-t border-border/50 p-1.5">
                <SidebarItem
                  label={t('sidebar.settings')}
                  icon={<SettingsIcon className="h-4 w-4" />}
                  onClick={() => setView('settings')}
                />
              </div>
            </Sidebar>
          }
          center={
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
                <Composer />
              </ComposerDock>
              {rightPanelCollapsed && (
                <ChatTimelineProgressRail placement="main-column-edge" />
              )}
            </MainColumnWithTimelineScroll>
          }
          right={
            <RightPanel>
              <RightPanelTabs
                panels={PANELS}
                activePanel={activePanel}
                setActivePanel={setActivePanel}
              />
              {!rightPanelCollapsed ? (
                <div className="flex-1 overflow-hidden">
                  <ErrorBoundary label="panel">
                    <Suspense fallback={<ShellSuspenseFallback label={t('common:loading')} />}>
                      <SidePanelHost item={activeCatalogItem} />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              ) : null}
            </RightPanel>
          }
        />
      </div>
      <AppToaster />
      <ExtensionUIHost />
      {paletteAndShortcuts}
      <Suspense fallback={null}>
        {modelPickerOpen && <ModelPicker />}
        {thinkingPickerOpen && <ThinkingPicker />}
        {treeOpen && <SessionTreeOverlay open={treeOpen} onClose={() => setTreeOpen(false)} />}
        {forkOpen && <SessionForkOverlay open={forkOpen} onClose={() => setForkOpen(false)} />}
      </Suspense>
    </ErrorBoundary>
  )
}
