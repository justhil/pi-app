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
import { onAppEvent, onWorkerExit, onAutoOpened, ipcClient } from '@renderer/lib/ipc-client'
import { syncRunStateFromWorker } from '@renderer/lib/sync-run-state'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon } from 'lucide-react'
import { buildRightPanelTabs } from '@renderer/lib/right-panel-catalog'
import { RightPanelTabs } from '@renderer/features/shell/right-panel-tabs'
import { loadNormalizedRightPanelPrefs } from '@renderer/lib/right-panel-runtime'
import { SidePanelHost } from '@renderer/features/side-panels/side-panel-host'
import { ExtensionUIHost } from '@renderer/features/extension-ui/extension-ui-host'
import { AppToaster } from '@renderer/components/app/app-toaster'
import { markExtensionNotifyAppReady } from '@renderer/lib/extension-notify-policy'

import { useDoubleEscapeTree } from '@renderer/hooks/use-double-escape-tree'

type View = 'main' | 'settings'

const SettingsPage = lazy(() => import('@renderer/features/settings/settings-page').then((m) => ({ default: m.SettingsPage })))
const ModelPicker = lazy(() => import('@renderer/features/composer/model-picker').then((m) => ({ default: m.ModelPicker })))
const ThinkingPicker = lazy(() => import('@renderer/features/composer/thinking-picker').then((m) => ({ default: m.ThinkingPicker })))
const SessionTreeOverlay = lazy(() => import('@renderer/features/rewind/session-tree-overlay').then((m) => ({ default: m.SessionTreeOverlay })))

export default function App() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('main')
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
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const ephemeralSandboxDraft = useUIStore((s) => s.ephemeralSandboxDraft)
  const [workspaceTitle, setWorkspaceTitle] = useState<string | undefined>()
  const canUseTree = view === 'main' && (!!currentWorkspace || ephemeralSandboxDraft)
  const { treeOpen, setTreeOpen } = useDoubleEscapeTree(canUseTree)

  useEffect(() => {
    if (ephemeralSandboxDraft) {
      setWorkspaceTitle('新对话')
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
    ipcClient.invoke('workspace.sandbox.list').then((r) => {
      const box = (r?.sandboxes || []).find((b: { path: string }) => b.path === currentWorkspace)
      setWorkspaceTitle(box?.label || '临时对话')
    }).catch(() => setWorkspaceTitle('临时对话'))
  }, [currentWorkspace, ephemeralSandboxDraft])

  const projectName = workspaceTitle

  useEffect(() => {
    markExtensionNotifyAppReady()
    useExtensionUIStore.getState().resetForSessionContext()
    const done = useUIStore.persist.onFinishHydration(() => {
      const ws = useUIStore.getState().currentWorkspace
      if (!ws || ws.replace(/\\/g, '/').includes('sandbox-workspaces/')) return
      void ipcClient.invoke('settings.get', { key: 'currentProject' }).then((r) => {
        const mainPath = r?.settings?.currentProject as string | undefined
        if (mainPath === ws) return
        void activateWorkspace(ws)
      })
    })
    return () => done()
  }, [])

  useEffect(() => {
    loadNormalizedRightPanelPrefs()
      .then(({ catalog, prefs, order }) => applyRightPanelRuntime(catalog, prefs, order))
      .catch(() => {})
  }, [applyRightPanelRuntime])

  useEffect(() => {
    const unsubEvents = onAppEvent((event) => useUIStore.getState().processEvent(event))
    const unsubExit = onWorkerExit((info) => {
      console.warn('Worker exited:', info)
    })
    const unsubAuto = onAutoOpened((info) => {
      const persisted = useUIStore.getState().currentWorkspace
      const norm = (p: string) => p.replace(/\\/g, '/')
      const isSandbox = (p: string) => norm(p).includes('sandbox-workspaces/')
      if (persisted && !isSandbox(persisted) && isSandbox(info.workspaceId)) {
        void activateWorkspace(persisted)
        return
      }
      setWorkspace(info.workspaceId)
      void syncRunStateFromWorker()
    })
    return () => {
      unsubEvents()
      unsubExit()
      unsubAuto()
    }
  }, [setWorkspace])

  // B-layer slash config-page routing: open settings view + adapters config subpage
  useEffect(() => {
    if (pendingExtensionConfig) {
      setView('settings')
    }
  }, [pendingExtensionConfig])

  const currentSessionId = useUIStore((s) => s.currentSessionId)

  useEffect(() => {
    if (!currentWorkspace) return
    ipcClient.invoke('session.list', { workspaceId: currentWorkspace }).then((res) => {
      const ss = res?.sessions || []
      if (res?.sessions) setSessions(res.sessions)
      if (currentSessionId) return
      if (ss.length > 0 && ss[0].sessionFile) {
        guardSessionSwitch(() => {
          void switchSessionInPlace(ss[0].sessionId, ss[0].sessionFile)
        })
      }
    }).catch(() => {})
  }, [currentWorkspace, setSessions, currentSessionId])

  const handleOpenProject = async () => {
    if (!window.piDesktop) {
      console.error('piDesktop not available')
      return
    }
    try {
      console.log('[App] Opening directory dialog...')
      const res = await window.piDesktop.invoke('ipc:dialog:openDirectory')
      console.log('[App] Dialog result:', res)
      if (res?.path) {
        console.log('[App] Opening workspace:', res.path)
        await activateWorkspace(res.path)
        setTimeout(() => void syncRunStateFromWorker(), 800)
      }
    } catch (e) {
      console.error('[App] Failed to open project:', e)
    }
  }

  const PANELS = buildRightPanelTabs(rightPanelCatalog, rightPanelPrefs, t, rightPanelOrder)
  const activeCatalogItem = rightPanelCatalog.find((c) => c.id === activePanel)

  if (view === 'settings') {
    return (
      <ErrorBoundary>
        <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <TopBar onBack={() => setView('main')} title={t('settings.title')} />
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <ErrorBoundary label="settings">
              <Suspense fallback={null}>
                <SettingsPage />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <ImmersiveChrome isRunning={isRunning} projectName={projectName} />
        <MainLayoutShell
          left={
            <Sidebar>
              <SidebarContent>
                <ProjectSidebar onOpenProject={handleOpenProject} openProjectLabel={t('sidebar.openProject')} />
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
            <MainColumnWithTimelineScroll className="main-chat-column h-full">
              <Timeline />
              <MainColRightPanelToggle />
              <ComposerDock>
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
              <div className="flex-1 overflow-hidden">
                <ErrorBoundary label="panel">
                  <Suspense fallback={null}>
                    <SidePanelHost item={activeCatalogItem} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </RightPanel>
          }
        />
      </div>
      <AppToaster />
      <ExtensionUIHost />
      <Suspense fallback={null}>
        {modelPickerOpen && <ModelPicker />}
        {thinkingPickerOpen && <ThinkingPicker />}
        {treeOpen && <SessionTreeOverlay open={treeOpen} onClose={() => setTreeOpen(false)} />}
      </Suspense>
    </ErrorBoundary>
  )
}

