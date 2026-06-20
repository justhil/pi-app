import { useEffect, useState } from 'react'
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
import { ReviewPanel } from '@renderer/features/review/review-panel'
import { RunPanel } from '@renderer/features/run/run-panel'
import { TrellisPanel } from '@renderer/features/trellis/trellis-panel'
import { ContextPanel } from '@renderer/features/context/context-panel'
import { IntercomPanel } from '@renderer/features/intercom/intercom-panel'
import { TreePanel } from '@renderer/features/rewind/tree-panel'
import { SettingsPage } from '@renderer/features/settings/settings-page'
import { TopBar } from '@renderer/components/app/top-bar'
import { ImmersiveChrome } from '@renderer/components/app/immersive-chrome'
import { useUIStore } from '@renderer/stores/ui-store'
import { onAppEvent, onWorkerExit, onAutoOpened, ipcClient } from '@renderer/lib/ipc-client'
import { syncRunStateFromWorker } from '@renderer/lib/sync-run-state'
import { switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, FolderOpen, GitBranch, ListTree, Activity, FileSearch, Radio } from 'lucide-react'
import { ExtensionUIHost } from '@renderer/features/extension-ui/extension-ui-host'
import { ModelPicker } from '@renderer/features/composer/model-picker'
import { ThinkingPicker } from '@renderer/features/composer/thinking-picker'
import { SessionTreeOverlay } from '@renderer/features/rewind/session-tree-overlay'
import { useDoubleEscapeTree } from '@renderer/hooks/use-double-escape-tree'

type View = 'main' | 'settings'

export default function App() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('main')
  const activePanel = useUIStore((s) => s.activePanel)
  const rightPanelCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
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

  const currentSessionId = useUIStore((s) => s.currentSessionId)

  useEffect(() => {
    if (!currentWorkspace) return
    ipcClient.invoke('session.list', { workspaceId: currentWorkspace }).then((res) => {
      const ss = res?.sessions || []
      if (res?.sessions) setSessions(res.sessions)
      if (currentSessionId) return
      if (ss.length > 0 && ss[0].sessionFile) {
        void switchSessionInPlace(ss[0].sessionId, ss[0].sessionFile)
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
        const wsResult = await ipcClient.invoke('workspace.open', { path: res.path })
        console.log('[App] Workspace result:', wsResult)
        if (wsResult?.workspaceId) {
          setWorkspace(res.path)
          const listRes = await ipcClient.invoke('session.list', { workspaceId: res.path })
          if (listRes?.sessions) setSessions(listRes.sessions)
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
    { key: 'tree' as const, label: 'Tree', icon: GitBranch },
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
              {rightPanelCollapsed && <ChatTimelineProgressRail placement="main-column-edge" />}
              <Timeline />
              <MainColRightPanelToggle />
              <ComposerDock>
                <Composer />
              </ComposerDock>
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
                  {activePanel === 'review' && <ReviewPanel />}
                  {activePanel === 'trellis' && <TrellisPanel />}
                  {activePanel === 'run' && <RunPanel />}
                  {activePanel === 'context' && <ContextPanel />}
                  {activePanel === 'intercom' && <IntercomPanel />}
                  {activePanel === 'tree' && (
                    <ErrorBoundary label="tree">
                      <TreePanel />
                    </ErrorBoundary>
                  )}
                </ErrorBoundary>
              </div>
            </RightPanel>
          }
        />
      </div>
      <ExtensionUIHost />
      <ModelPicker />
      <ThinkingPicker />
      <SessionTreeOverlay open={treeOpen} onClose={() => setTreeOpen(false)} />
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
  return (
    <div className="flex items-center border-b border-border/50">
      {panels.map((p) => (
        <button
          key={p.key}
          onClick={() => setActivePanel(p.key)}
          className={cn(
            'row-hover flex flex-1 items-center justify-center gap-1.5 px-1 py-2.5 text-[11px] font-medium whitespace-nowrap rounded-md transition-colors duration-200',
            activePanel === p.key
              ? 'bg-[var(--bg-active)] text-foreground'
              : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
          )}
        >
          <p.icon className="h-3 w-3 shrink-0" />
          <span className="truncate">{p.label}</span>
        </button>
      ))}
    </div>
  )
}
