import { useTranslation } from 'react-i18next'
import { ChevronLeft, Zap, Circle, FolderOpen, Plus, MessageSquare, Settings, Activity, GitBranch, ListTree, CircleDot, PanelLeft, PanelRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { isMac, MAC_TRAFFIC_LIGHTS_SPACER_CLASS } from '@renderer/lib/platform'
import { WindowControls } from '@renderer/components/app/window-controls'

interface TopBarProps {
  onBack?: () => void
  title?: string
  /** @deprecated ignored — running status chrome removed */
  isRunning?: boolean
  projectName?: string
}

export function TopBar({ onBack, title, projectName }: TopBarProps) {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const rightCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const showRightToggle = !onBack
  const isSettings = !!onBack
  return (
    <div className="electron-drag flex h-11 items-center justify-between border-b border-border/60 px-3" style={{ background: 'var(--surface-sidebar)' }}>
      <div className="electron-no-drag flex min-w-0 items-center gap-2.5">
        {isMac && <div aria-hidden className={MAC_TRAFFIC_LIGHTS_SPACER_CLASS} />}
        {!onBack && (
          <button
            onClick={toggleSidebar}
            title={collapsed ? t('common:topbar.expandSidebar') : t('common:topbar.collapseSidebar')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-motion-fast ease-motion-ease active:scale-[0.93]"
          >
            <PanelLeft className={cn('h-3.5 w-3.5 transition-transform duration-motion-normal ease-motion-ease', collapsed && 'rotate-180')} />
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onBack()
            }}
            className="electron-no-drag chrome-icon-btn flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-foreground-secondary hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('common:topbar.back')}
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <CircleDot className="h-3.5 w-3.5 text-primary" />
          <span className="text-[13px] font-semibold tracking-tight">{title || t('common:app.name')}</span>
        </div>
        {projectName && (
          <>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-[13px] text-muted-foreground">{projectName}</span>
          </>
        )}
      </div>
      <div className="electron-no-drag flex h-9 shrink-0 items-center gap-2">
        {showRightToggle && (
          <button
            type="button"
            onClick={toggleRightPanel}
            title={rightCollapsed ? t('common:topbar.expandRightPanel') : t('common:topbar.collapseRightPanel')}
            className="chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground"
          >
            <PanelRight className={cn('h-3.5 w-3.5 transition-transform duration-motion-normal ease-motion-ease', rightCollapsed && 'rotate-180')} />
          </button>
        )}
        <WindowControls className={isSettings ? '-mr-2 border-l border-border/40 pl-0.5' : undefined} />
      </div>
    </div>
  )
}
