import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileDiff,
  Folder,
  GitBranch,
  Globe,
  Layers,
  RefreshCw,
  Settings,
  Terminal,
} from '@renderer/components/icons'
import { PiMark } from '@renderer/components/brand/pi-mark'
import { NotificationInbox } from '@renderer/features/shell/notification-inbox'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { isPanelVisibleInRightDock, useRightDockStore } from '@renderer/stores/right-dock-store'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { useBrowserStore } from '@renderer/features/browser/browser-store'
import { selectVisibleSurfaces, useCanvasStore } from '@renderer/features/canvas/canvas-store'
import { terminalActions, useTerminalStore } from '@renderer/features/terminal/terminal-store'

interface LeftActivityRailProps {
  onOpenSettings: () => void
  onReloadAll: () => void
  reloading?: boolean
  hasGitRepo?: boolean
  diffCount?: number
}

/** 48px far-left activity rail: shares x=24px vertical axis with topbar sidebar toggle and 48px top row with all columns. */
export function LeftActivityRail({
  onOpenSettings,
  onReloadAll,
  reloading = false,
  hasGitRepo = true,
  diffCount = 0,
}: LeftActivityRailProps) {
  const { t } = useTranslation()
  const rightHidden = useRightPanelHidden()
  const openTabIds = useRightDockStore((s) => s.openTabIds)
  const dockTopActive = useRightDockStore((s) => s.topActive)
  const dockBottomActive = useRightDockStore((s) => s.bottomActive)
  const launchpadOpen = useRightDockStore((s) => s.launchpadOpen)
  const activePanel = useUIStore((s) => s.activePanel)
  const terminalOpen = useTerminalStore((s) => s.open)
  const browserAgentBusy = useBrowserStore((s) => Boolean(s.agentAction))
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const canvasSurfaces = useCanvasStore((s) => s.surfaces)
  const canvasHasAi = useMemo(
    () => selectVisibleSurfaces(canvasSurfaces, historySessionFile, false).some((item) => item.source === 'ai'),
    [canvasSurfaces, historySessionFile],
  )
  const railVisible = useUIStore((s) => s.uiCustomization.shellActivityRailVisible)
  const railStyle = useUIStore((s) => s.uiCustomization.shellActivityRailStyle)

  const visiblePanels = useMemo(() => {
    void openTabIds
    void dockTopActive
    void dockBottomActive
    void activePanel
    if (rightHidden || launchpadOpen) return new Set<string>()
    const set = new Set<string>()
    for (const id of ['files', 'review', 'canvas', 'browser', 'worktrees']) {
      if (isPanelVisibleInRightDock(id)) set.add(id)
    }
    return set
  }, [rightHidden, launchpadOpen, openTabIds, dockTopActive, dockBottomActive, activePanel])

  if (!railVisible) return null

  const compact = railStyle === 'compact'
  const floating = railStyle === 'floating'

  const openOrTogglePanel = (panelId: string) => {
    usePanelIntentStore.getState().toggleRightPanelTab(panelId, !rightHidden)
  }

  const railBtn = (active: boolean) =>
    cn(
      'left-rail-btn relative flex items-center justify-center rounded-lg transition-colors',
      compact ? 'h-7 w-7' : 'h-8 w-8',
      active
        ? 'left-rail-btn--active bg-foreground/[0.08] text-foreground'
        : 'text-foreground-secondary/75 hover:bg-foreground/[0.05] hover:text-foreground',
    )

  const iconCls = compact ? 'h-[15px] w-[15px]' : 'h-[16px] w-[16px]'

  return (
    <aside
      data-pi-slot="left-activity-rail"
      data-rail-style={railStyle}
      aria-label="Workbench navigation"
      className={cn(
        'flex h-full shrink-0 flex-col items-center justify-between select-none',
        compact ? 'w-10 pb-2.5' : 'w-12 pb-3',
        floating && 'px-1.5 py-1.5',
      )}
      style={{ background: 'var(--surface-frame)' }}
    >
      <div
        className={cn(
          'flex w-full flex-1 flex-col items-center justify-between',
          floating &&
            'left-rail-floating-pill rounded-2xl border border-foreground/[0.06] bg-background/60 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.03)] backdrop-blur-sm dark:bg-foreground/[0.03]',
        )}
      >
        {/* Top 48px cell aligned strictly with the 48px headers of Left / Center / Right columns */}
        <div className="flex w-full flex-col items-center">
          <div className={cn('flex w-full shrink-0 items-center justify-center', floating ? 'h-9' : 'h-12')}>
            <button
              type="button"
              onClick={() => {
                if (useUIStore.getState().sidebarCollapsed) {
                  useUIStore.getState().toggleSidebar()
                }
              }}
              title={t('common:app.name')}
              aria-label={t('common:app.name')}
              className={cn(
                'flex items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground transition-colors hover:bg-foreground/[0.1]',
                compact ? 'h-7 w-7' : 'h-8 w-8',
              )}
            >
              <PiMark size={compact ? 14 : 16} className="rounded-[3px]" />
            </button>
          </div>

          <div className={cn('flex flex-col items-center', compact ? 'mt-1 gap-1.5' : 'mt-1 gap-2')}>
            <button
              type="button"
              onClick={() => openOrTogglePanel('files')}
              aria-pressed={visiblePanels.has('files')}
              title={t('common:panel.files')}
              aria-label={t('common:panel.files')}
              className={railBtn(visiblePanels.has('files'))}
            >
              <Folder className={iconCls} strokeWidth={1.6} />
            </button>

            {hasGitRepo ? (
              <button
                type="button"
                onClick={() => openOrTogglePanel('review')}
                aria-pressed={visiblePanels.has('review')}
                title={t('common:panel.review')}
                aria-label={t('common:panel.review')}
                className={railBtn(visiblePanels.has('review'))}
              >
                <FileDiff className={iconCls} strokeWidth={1.6} />
                {diffCount > 0 ? (
                  <span
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--diff-added)]"
                    aria-hidden
                  />
                ) : null}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => openOrTogglePanel('canvas')}
              aria-pressed={visiblePanels.has('canvas')}
              title={t('common:topbar.stageCanvas')}
              aria-label={t('common:topbar.stageCanvas')}
              className={railBtn(visiblePanels.has('canvas'))}
            >
              <Layers className={iconCls} strokeWidth={1.6} />
              {canvasHasAi && !visiblePanels.has('canvas') ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--brand)]" aria-hidden />
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => openOrTogglePanel('browser')}
              aria-pressed={visiblePanels.has('browser')}
              title={t('common:topbar.stageBrowser')}
              aria-label={t('common:topbar.stageBrowser')}
              className={railBtn(visiblePanels.has('browser'))}
            >
              <Globe className={iconCls} strokeWidth={1.6} />
              {browserAgentBusy ? (
                <span
                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--brand)] animate-pulse"
                  aria-hidden
                />
              ) : null}
            </button>

            <div className="h-1" aria-hidden />

            <button
              type="button"
              onClick={() => openOrTogglePanel('worktrees')}
              aria-pressed={visiblePanels.has('worktrees')}
              title={t('common:panel.worktrees')}
              aria-label={t('common:panel.worktrees')}
              className={railBtn(visiblePanels.has('worktrees'))}
            >
              <GitBranch className={iconCls} strokeWidth={1.6} />
            </button>

            <button
              type="button"
              onClick={() => terminalActions.toggle()}
              aria-pressed={terminalOpen}
              title={t('common:topbar.terminal')}
              aria-label={t('common:topbar.terminal')}
              className={railBtn(terminalOpen)}
            >
              <Terminal className={iconCls} strokeWidth={1.6} />
            </button>
          </div>
        </div>

        {/* Bottom utility stack on the same vertical axis */}
        <div className={cn('flex flex-col items-center', compact ? 'gap-1.5' : 'gap-2')}>
          <button
            type="button"
            onClick={onReloadAll}
            disabled={reloading}
            title={t('common:sessionReload.title')}
            aria-label={t('common:sessionReload.title')}
            className={cn(
              'flex items-center justify-center rounded-lg text-foreground-secondary/70 transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40',
              compact ? 'h-7 w-7' : 'h-8 w-8',
            )}
          >
            <RefreshCw className={cn('h-[15px] w-[15px]', reloading && 'animate-spin')} strokeWidth={1.6} />
          </button>

          <NotificationInbox
            buttonClassName={cn(
              'relative flex items-center justify-center rounded-lg text-foreground-secondary/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
              compact ? 'h-7 w-7' : 'h-8 w-8',
            )}
          />

          <button
            type="button"
            onClick={onOpenSettings}
            title={t('common:sidebar.settings')}
            aria-label={t('common:sidebar.settings')}
            className={cn(
              'flex items-center justify-center rounded-lg text-foreground-secondary/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
              compact ? 'h-7 w-7' : 'h-8 w-8',
            )}
          >
            <Settings className={iconCls} strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </aside>
  )
}
