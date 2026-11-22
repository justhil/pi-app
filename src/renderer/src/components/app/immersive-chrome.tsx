import { useTranslation } from 'react-i18next'
import { Globe, PanelLeft, PanelRight } from '@renderer/components/icons'
import { useBrowserStore } from '@renderer/features/browser/browser-store'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { PiMark } from '@renderer/components/brand/pi-mark'
import { WindowControls } from '@renderer/components/app/window-controls'
import { NotificationInbox } from '@renderer/features/shell/notification-inbox'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { isMac, MAC_TRAFFIC_LIGHTS_SPACER_CLASS } from '@renderer/lib/platform'

/** 无边框窗口顶栏：可拖拽区域 + 侧栏开关（主对话页无厚重 TopBar；无运行绿点/状态条） */
export function ImmersiveChrome({
  projectName,
}: {
  projectName?: string
  /** @deprecated ignored — status strip removed for lower chrome noise */
  isRunning?: boolean
  /** @deprecated ignored */
  statusLabelKey?: string
}) {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const rightHidden = useRightPanelHidden()
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const browserStageMode = useUIStore((s) => s.browserStageMode)
  const toggleBrowserStage = useUIStore((s) => s.toggleBrowserStage)
  const browserTabCount = useBrowserStore((s) => s.order.length)
  const browserAgentBusy = useBrowserStore((s) => Boolean(s.agentAction))
  return (
    <div
      className="electron-drag relative z-20 flex h-9 shrink-0 items-center justify-between px-2"
      style={{ background: 'color-mix(in srgb, var(--surface-sidebar) 92%, transparent)' }}
    >
      <div className="electron-no-drag flex items-center gap-1">
        {isMac && <div aria-hidden className={MAC_TRAFFIC_LIGHTS_SPACER_CLASS} />}
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? t('common:topbar.expandSidebar') : t('common:topbar.collapseSidebar')}
          className="chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary"
        >
          <PanelLeft
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-[var(--motion-normal)] ease-[var(--motion-ease)]',
              collapsed && 'rotate-180',
            )}
          />
        </button>
        <div className="flex items-center gap-1.5 px-1 text-[12px] text-foreground-secondary select-none">
          <PiMark size={14} className="rounded-[3px]" />
          <span className="font-medium text-foreground/90">pi</span>
          {projectName && (
            <>
              <span className="opacity-35">/</span>
              <span className="max-w-[200px] truncate">{projectName}</span>
            </>
          )}
        </div>
      </div>
      <div className="electron-no-drag flex h-9 items-center gap-2">
        <NotificationInbox />
        <button
          type="button"
          data-pi-slot="topbar-browser-toggle"
          onClick={toggleBrowserStage}
          aria-pressed={browserStageMode !== 'closed'}
          title={t('browser:stage.toggleTooltip')}
          aria-label={t('browser:stage.toggleTooltip')}
          className={cn(
            'chrome-icon-btn relative flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-[11.5px] text-foreground-secondary transition-colors',
            browserStageMode !== 'closed' && 'bg-[var(--bg-active)] text-foreground',
          )}
        >
          <Globe className="h-3.5 w-3.5" />
          {browserTabCount > 0 ? (
            <span className="font-mono text-[10.5px] opacity-80">{browserTabCount}</span>
          ) : null}
          {browserAgentBusy ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand)]" aria-hidden />
          ) : null}
        </button>
        <button
          type="button"
          data-right-panel-toggle=""
          onClick={toggleRightPanel}
          aria-pressed={!rightHidden}
          title={rightHidden ? t('common:topbar.expandRightPanel') : t('common:topbar.collapseRightPanel')}
          aria-label={rightHidden ? t('common:topbar.expandRightPanel') : t('common:topbar.collapseRightPanel')}
          className={cn(
            'chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary',
            !rightHidden && 'bg-[var(--bg-active)] text-foreground',
          )}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
        <WindowControls className="-mr-2 border-l border-border/40 pl-0.5" />
      </div>
    </div>
  )
}