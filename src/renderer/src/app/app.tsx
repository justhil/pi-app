import { useEffect, useState } from 'react'
import { ErrorBoundary } from '@renderer/components/app/error-boundary'
import { Sidebar, SidebarContent, SidebarItem } from '@renderer/components/ui/sidebar'
import { SessionList, ProjectHeader } from '@renderer/features/workspace/session-list'
import { Timeline } from '@renderer/features/timeline/timeline'
import { Composer } from '@renderer/features/composer/composer'
import { ReviewPanel } from '@renderer/features/review/review-panel'
import { RunPanel } from '@renderer/features/run/run-panel'
import { TrellisPanel } from '@renderer/features/trellis/trellis-panel'
import { SettingsPage } from '@renderer/features/settings/settings-page'
import { TopBar } from '@renderer/components/app/top-bar'
import { useUIStore } from '@renderer/stores/ui-store'
import { onAppEvent, onWorkerExit, onAutoOpened, ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, FolderOpen, GitBranch, ListTree, Activity } from 'lucide-react'

type View = 'main' | 'settings'

export default function App() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('main')
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const processEvent = useUIStore((s) => s.processEvent)
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setSessions = useUIStore((s) => s.setSessions)
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const projectName = currentWorkspace ? currentWorkspace.split(/[\\/]/).pop() : undefined

  useEffect(() => {
    const unsubEvents = onAppEvent((event) => processEvent(event))
    const unsubExit = onWorkerExit((info) => {
      console.warn('Worker exited:', info)
    })
    const unsubAuto = onAutoOpened((info) => {
      setWorkspace(info.workspaceId)
    })
    return () => {
      unsubEvents()
      unsubExit()
      unsubAuto()
    }
  }, [processEvent, setWorkspace])

  useEffect(() => {
    if (currentWorkspace) {
      ipcClient.invoke('session.list', { workspaceId: currentWorkspace }).then((res) => {
        if (res?.sessions) setSessions(res.sessions)
      }).catch(() => {})
    }
  }, [currentWorkspace, setSessions])

  const handleOpenProject = async () => {
    if (!window.piDesktop) return
    try {
      const res = await window.piDesktop.invoke('ipc:dialog:openDirectory')
      if (res?.path) {
        const wsResult = await ipcClient.invoke('workspace.open', { path: res.path })
        if (wsResult?.workspaceId) {
          setWorkspace(res.path)
        }
      }
    } catch (e) {
      console.error('Failed to open project:', e)
    }
  }

  const PANELS = [
    { key: 'review' as const, label: t('panel.review'), icon: GitBranch },
    { key: 'trellis' as const, label: t('panel.trellis'), icon: ListTree },
    { key: 'run' as const, label: t('panel.run'), icon: Activity },
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
              <div className="px-2 py-1">
                <button
                  onClick={handleOpenProject}
                  className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('sidebar.openProject')}
                </button>
              </div>
              <SessionList />
            </SidebarContent>
            <div className="border-t border-border/80 p-1.5">
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
          <aside className="flex w-72 shrink-0 flex-col border-l border-border/80 bg-muted/10">
            <div className="flex border-b border-border/80">
              {PANELS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setActivePanel(p.key)}
                  className={cn(
                    'relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-all duration-motion-fast ease-motion-ease',
                    activePanel === p.key
                      ? 'text-foreground'
                      : 'text-muted-foreground/60 hover:text-muted-foreground',
                  )}
                >
                  <p.icon className="h-3 w-3" />
                  {p.label}
                  {activePanel === p.key && (
                    <div className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary label="panel">
                {activePanel === 'review' && <ReviewPanel />}
                {activePanel === 'trellis' && <TrellisPanel />}
                {activePanel === 'run' && <RunPanel />}
              </ErrorBoundary>
            </div>
          </aside>
        </div>
      </div>
    </ErrorBoundary>
  )
}
