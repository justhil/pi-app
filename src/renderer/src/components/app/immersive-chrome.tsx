import { useTranslation } from 'react-i18next'
import { PanelLeft, PanelRight, RefreshCw, Settings } from '@renderer/components/icons'
import { WindowControls } from '@renderer/components/app/window-controls'
import { NotificationInbox } from '@renderer/features/shell/notification-inbox'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { isMac, MAC_TRAFFIC_LIGHTS_SPACER_CLASS } from '@renderer/lib/platform'

export interface TopbarGitDiffStat {
  files: number
  additions: number
  deletions: number
}

/** Codex-style quiet window bar: sidebar button aligned with LeftActivityRail, plus fallback utility icons when rail/header are hidden. */
export function ImmersiveChrome({
  onOpenSettings,
  onReloadAll,
  reloading = false,
}: {
  projectName?: string
  sessionTitle?: string
  gitBranch?: string
  gitDiffStat?: TopbarGitDiffStat | null
  onOpenSettings?: () => void
  onReloadAll?: () => void
  reloading?: boolean
  /** @deprecated ignored */
  isRunning?: boolean
  /** @deprecated ignored */
  statusLabelKey?: string
}) {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const rightHidden = useRightPanelHidden()
  const ui = useUIStore((s) => s.uiCustomization)

  const railVisible = ui.shellActivityRailVisible
  const railCompact = ui.shellActivityRailStyle === 'compact'
  const topCompact = ui.shellTopBarCompact
  const headerVisible = ui.shellChatHeaderVisible
  const barHeightCls = topCompact ? 'h-[30px]' : 'h-9'
  const btnSizeCls = topCompact ? 'h-6 w-6' : 'h-7 w-7'

  return (
    <div
      data-pi-slot="shell-top-bar"
      className={cn(
        'electron-drag relative z-20 flex shrink-0 items-center justify-between pr-0',
        barHeightCls,
      )}
      style={{ background: 'var(--surface-frame)' }}
    >
      <div className="electron-no-drag flex h-full items-center">
        {isMac ? <div aria-hidden className={MAC_TRAFFIC_LIGHTS_SPACER_CLASS} /> : null}
        {/* Align sidebar toggle strictly with LeftActivityRail axis when rail is visible */}
        <div
          className={cn(
            'flex h-full shrink-0 items-center justify-center',
            railVisible ? (railCompact ? 'w-10' : 'w-12') : 'pl-2.5 pr-1',
          )}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            title={collapsed ? t('common:topbar.expandSidebar') : t('common:topbar.collapseSidebar')}
            aria-label={collapsed ? t('common:topbar.expandSidebar') : t('common:topbar.collapseSidebar')}
            className={cn(
              'flex items-center justify-center rounded-md transition-colors',
              btnSizeCls,
              collapsed
                ? 'text-foreground-secondary/70 hover:bg-foreground/[0.06] hover:text-foreground'
                : 'text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground',
            )}
          >
            <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <div className={cn('electron-no-drag flex items-center', barHeightCls)}>
        {(!railVisible || (!headerVisible && rightHidden)) ? (
          <div className="mr-1.5 flex items-center gap-0.5">
            {!railVisible && onReloadAll ? (
              <button
                type="button"
                onClick={onReloadAll}
                disabled={reloading}
                title={t('common:sessionReload.title')}
                aria-label={t('common:sessionReload.title')}
                className={cn(
                  'flex items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40',
                  btnSizeCls,
                )}
              >
                <RefreshCw className={cn('h-[14px] w-[14px]', reloading && 'animate-spin')} strokeWidth={1.6} />
              </button>
            ) : null}
            {!railVisible ? (
              <NotificationInbox
                buttonClassName={cn(
                  'relative flex items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
                  btnSizeCls,
                )}
              />
            ) : null}
            {!headerVisible && rightHidden ? (
              <button
                type="button"
                data-right-panel-toggle=""
                onClick={toggleRightPanel}
                title={t('common:topbar.expandRightPanel')}
                aria-label={t('common:topbar.expandRightPanel')}
                className={cn(
                  'flex items-center justify-center rounded-md text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
                  btnSizeCls,
                )}
              >
                <PanelRight className="h-[15px] w-[15px]" strokeWidth={1.6} />
              </button>
            ) : null}
            {!railVisible && onOpenSettings ? (
              <button
                type="button"
                onClick={onOpenSettings}
                title={t('common:sidebar.settings')}
                aria-label={t('common:sidebar.settings')}
                className={cn(
                  'flex items-center justify-center rounded-md text-foreground-secondary/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
                  btnSizeCls,
                )}
              >
                <Settings className="h-[15px] w-[15px]" strokeWidth={1.6} />
              </button>
            ) : null}
          </div>
        ) : null}
        <WindowControls className={barHeightCls} />
      </div>
    </div>
  )
}
