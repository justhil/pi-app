import { useEffect } from 'react'
import { Sidebar, SidebarContent, SidebarItem } from '@renderer/components/ui/sidebar'
import { SessionList, ProjectHeader } from '@renderer/features/workspace/session-list'
import { Timeline } from '@renderer/features/timeline/timeline'
import { Composer } from '@renderer/features/composer/composer'
import { ReviewPanel } from '@renderer/features/review/review-panel'
import { RunPanel } from '@renderer/features/run/run-panel'
import { TrellisPanel } from '@renderer/features/trellis/trellis-panel'
import { TopBar } from '@renderer/components/app/top-bar'
import { useUIStore } from '@renderer/stores/ui-store'
import { onAppEvent } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'

export default function App() {
  const { t } = useTranslation()
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const processEvent = useUIStore((s) => s.processEvent)

  useEffect(() => {
    const unsubscribe = onAppEvent((event) => {
      processEvent(event)
    })
    return unsubscribe
  }, [processEvent])

  const PANELS = [
    { key: 'review' as const, label: t('panel.review') },
    { key: 'trellis' as const, label: t('panel.trellis') },
    { key: 'run' as const, label: t('panel.run') },
  ]

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar>
          <ProjectHeader />
          <SidebarContent>
            <SessionList />
          </SidebarContent>
          <div className="border-t border-border p-2">
            <SidebarItem label={t('sidebar.settings')} />
          </div>
        </Sidebar>

        {/* Main timeline + composer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Timeline />
          <Composer />
        </div>

        {/* Right panels */}
        <aside className="flex w-80 flex-col border-l border-border">
          <div className="flex border-b border-border">
            {PANELS.map((p) => (
              <button
                key={p.key}
                onClick={() => setActivePanel(p.key)}
                className={cn(
                  'flex-1 px-2 py-2.5 text-xs font-medium transition-all duration-motion-fast ease-motion-ease',
                  activePanel === p.key
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {activePanel === 'review' && <ReviewPanel />}
            {activePanel === 'trellis' && <TrellisPanel />}
            {activePanel === 'run' && <RunPanel />}
          </div>
        </aside>
      </div>
    </div>
  )
}
