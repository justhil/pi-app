import { useTranslation } from 'react-i18next'
import { ChevronLeft, CircleDot, PanelLeft, PanelRight } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
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
  const rightCollapsed = useRightPanelHidden()
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const showRightToggle = !onBack
  const isSettings = !!onBack
  return (
    <div
      className="electron-drag flex h-9 shrink-0 items-center justify-between pl-2.5 pr-0"
      style={{ background: 'var(--surface-frame)' }}
    >
      <div className="electron-no-drag flex min-w-0 items-center gap-2">
        {isMac && <div aria-hidden className={MAC_TRAFFIC_LIGHTS_SPACER_CLASS} />}
        {!onBack && (
          <button
            onClick={toggleSidebar}
            title={collapsed ? t('common:topbar.expandSidebar') : t('common:topbar.collapseSidebar')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-foreground/[0.06] hover:text-foreground active:scale-95"
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
            className="electron-no-drag chrome-icon-btn flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-foreground-secondary transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>{t('common:topbar.back')}</span>
          </button>
        )}
        {isSettings ? (
          <span className="h-3.5 w-px bg-foreground/[0.1]" aria-hidden />
        ) : null}
        <div className="flex items-center gap-1.5">
          {!isSettings && <CircleDot className="h-3.5 w-3.5 text-primary" />}
          <span className="text-[13px] font-medium tracking-[-0.01em] text-foreground/90">
            {title || t('common:app.name')}
          </span>
        </div>
        {projectName && (
          <>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-[13px] text-muted-foreground">{projectName}</span>
          </>
        )}
      </div>
      <div className="electron-no-drag flex h-9 shrink-0 items-center gap-1">
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
        <WindowControls className="h-9" />
      </div>
    </div>
  )
}
