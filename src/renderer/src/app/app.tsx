import { useEffect, useState } from 'react'
import { ErrorBoundary } from '@renderer/components/app/error-boundary'
import { Sidebar, SidebarContent, SidebarItem, RightPanel } from '@renderer/components/ui/sidebar'
import { SessionList, ProjectHeader, OpenProjectButton } from '@renderer/features/workspace/session-list'
import { Timeline } from '@renderer/features/timeline/timeline'
import { Composer } from '@renderer/features/composer/composer'
import { ReviewPanel } from '@renderer/features/review/review-panel'
import { RunPanel } from '@renderer/features/run/run-panel'
import { TrellisPanel } from '@renderer/features/trellis/trellis-panel'
import { ContextPanel } from '@renderer/features/context/context-panel'
import { IntercomPanel } from '@renderer/features/intercom/intercom-panel'
import { SettingsPage } from '@renderer/features/settings/settings-page'
import { TopBar } from '@renderer/components/app/top-bar'
import { useUIStore } from '@renderer/stores/ui-store'
import { onAppEvent, onWorkerExit, onAutoOpened, ipcClient } from '@renderer/lib/ipc-client'
import { syncRunStateFromWorker } from '@renderer/lib/sync-run-state'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, FolderOpen, GitBranch, ListTree, Activity, FileSearch, Radio, PanelRight } from 'lucide-react'
import { ExtensionUIHost } from '@renderer/features/extension-ui/extension-ui-host'
import { ModelPicker } from '@renderer/features/composer/model-picker'
import { ThinkingPicker } from '@renderer/features/composer/thinking-picker'

type View = 'main' | 'settings'

export default function App() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('main')
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setSessions = useUIStore((s) => s.setSessions)
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const projectName = currentWorkspace ? currentWorkspace.split(/[\\/]/).pop() : undefined

  useEffect(() => {
    const unsubEvents = onAppEvent((event) => useUIStore.getState().processEvent(event))
    const unsubExit = onWorkerExit((info) => {
      console.warn('Worker exited:', info)
    })
    const unsubAuto = onAutoOpened((info) => {
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

  useEffect(() => {
    if (currentWorkspace) {
      ipcClient.invoke('session.list', { workspaceId: currentWorkspace }).then((res) => {
        const ss = res?.sessions || []
        if (res?.sessions) setSessions(res.sessions)
        // Auto-open the most recent session to show history immediately
        if (ss.length > 0 && ss[0].sessionFile) {
          const latest = ss[0]
          void openSessionIntoWorker(latest.sessionId, latest.sessionFile)
        }
      }).catch(() => {})
    }
  }, [currentWorkspace, setSessions])

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
        const wsResult = await ipcClient.invoke('workspace.open', { path: res.path })
        console.log('[App] Workspace result:', wsResult)
        if (wsResult?.workspaceId) {
          setWorkspace(res.path)
          setTimeout(() => void syncRunStateFromWorker(), 800)
        }
      }
    } catch (e) {
      console.error('[App] Failed to open project:', e)
    }
  }

  const PANELS = [
    { key: 'review' as const, label: t('panel.review'), icon: GitBranch },
    { key: 'trellis' as const, label: t('panel.trellis'), icon: ListTree },
    { key: 'run' as const, label: t('panel.run'), icon: Activity },
    { key: 'context' as const, label: 'Context', icon: FileSearch },
    { key: 'intercom' as const, label: 'Intercom', icon: Radio },
  ]

  if (view === 'settings') {
    return (
      <ErrorBoundary>
        <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <TopBar onBack={() => setView('main')} title={t('settings.title')} />
          <div className="flex flex-1 overflow-hidden">
            <ErrorBoundary label="settings">
              <SettingsPage />
            </ErrorBoundary>
          </div>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar isRunning={isRunning} projectName={projectName} />
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <Sidebar>
            <ProjectHeader />
            <SidebarContent>
              <OpenProjectButton onClick={handleOpenProject} label={t('sidebar.openProject')} />
              <SessionList />
            </SidebarContent>
            <div className="border-t border-border/50 p-1.5">
              <SidebarItem
                label={t('sidebar.settings')}
                icon={<SettingsIcon className="h-3.5 w-3.5" />}
                onClick={() => setView('settings')}
              />
            </div>
          </Sidebar>

          {/* Main timeline + composer */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Timeline />
            <Composer />
          </div>

          {/* Right panels */}
          <RightPanel>
            <RightPanelTabs
              panels={PANELS}
              activePanel={activePanel}
              setActivePanel={setActivePanel}
            />
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary label="panel">
                {activePanel === 'review' && <ReviewPanel />}
                {activePanel === 'trellis' && <TrellisPanel />}
                {activePanel === 'run' && <RunPanel />}
                {activePanel === 'context' && <ContextPanel />}
                {activePanel === 'intercom' && <IntercomPanel />}
              </ErrorBoundary>
            </div>
          </RightPanel>
        </div>
      </div>
      <ExtensionUIHost />
      <ModelPicker />
      <ThinkingPicker />
    </ErrorBoundary>
  )
}

function RightPanelTabs({
  panels,
  activePanel,
  setActivePanel,
}: {
  panels: { key: string; label: string; icon: any }[]
  activePanel: string
  setActivePanel: (p: any) => void
}) {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggle = useUIStore((s) => s.toggleRightPanel)

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-b border-border/50 py-2">
        {panels.map((p) => (
          <button
            key={p.key}
            onClick={() => setActivePanel(p.key)}
            title={p.label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-motion-fast ease-motion-ease active:scale-[0.93]',
              activePanel === p.key
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground/60 hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <p.icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <div className="my-1 h-px w-6 bg-border/50" />
        <button
          onClick={toggle}
          title="展开面板"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 hover:bg-accent/60 hover:text-foreground transition-all duration-motion-fast ease-motion-ease active:scale-[0.93]"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center border-b border-border/50 pr-1">
      {panels.map((p) => (
        <button
          key={p.key}
          onClick={() => setActivePanel(p.key)}
 className={cn(
            'relative flex flex-1 items-center justify-center gap-1.5 px-1 py-2.5 text-[11px] font-medium whitespace-nowrap transition-all duration-motion-fast ease-motion-ease',
            activePanel === p.key
              ? 'text-foreground'
              : 'text-muted-foreground/60 hover:text-muted-foreground',
          )}
        >
          <p.icon className="h-3 w-3 shrink-0" />
          <span className="truncate">{p.label}</span>
          {activePanel === p.key && (
            <div className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
      <button
        onClick={toggle}
        title="收起面板"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease active:scale-[0.93]"
      >
        <PanelRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
