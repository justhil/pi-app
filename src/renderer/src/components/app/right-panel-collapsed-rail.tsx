import { useMemo } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { buildRightPanelTabs } from '@renderer/lib/right-panel-catalog'
import { useTranslation } from 'react-i18next'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'

/**
 * Cursor-inspired collapsed right rail:
 * - thin icon strip instead of full disappearance
 * - run pulse at top when agent is active
 * - one-click open + switch panel
 */
export function RightPanelCollapsedRail() {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const rightPanelCatalog = useUIStore((s) => s.rightPanelCatalog)
  const rightPanelPrefs = useUIStore((s) => s.rightPanelPrefs)
  const rightPanelOrder = useUIStore((s) => s.rightPanelOrder)
  const runState = useUIStore((s) => s.runState)
  const errorCount = useUIStore((s) => s.runState.errorCount)

  const isRunning = useUIStore((s) =>
    composerTurnActive({
      historySessionFile: s.historySessionFile,
      workerLiveSnapshot: s.workerLiveSnapshot,
      runState: s.runState,
      streamingAssistantId: s.streamingAssistantId,
      optimisticPendingUserText: s.optimisticPendingUserText,
      sessionRuntimeRunning: s.sessionRuntimeRunning,
      agentTurnBootstrapping: s.agentTurnBootstrapping,
    }),
  )

  const panels = useMemo(
    () => buildRightPanelTabs(rightPanelCatalog, rightPanelPrefs, t, rightPanelOrder),
    [rightPanelCatalog, rightPanelPrefs, rightPanelOrder, t],
  )

  if (!collapsed) return null

  const openPanel = (panelKey: string) => {
    setActivePanel(panelKey)
    if (useUIStore.getState().rightPanelCollapsed) {
      toggleRightPanel()
    }
  }

  const statusTitle = isRunning
    ? runState.activeTool
      ? `Running · ${runState.activeTool}`
      : 'Running'
    : runState.status === 'failed'
      ? 'Failed'
      : errorCount > 0
        ? `${errorCount} tool errors`
        : 'Idle'

  return (
    <aside
      className="right-collapsed-rail electron-no-drag flex h-full w-10 shrink-0 flex-col items-center border-l border-border/40 py-2"
      style={{ background: 'color-mix(in srgb, var(--bg-base) 96%, var(--surface-sidebar))' }}
      aria-label="Right panel rail"
    >
      <button
        type="button"
        title={statusTitle}
        onClick={() => openPanel('run')}
        className={cn(
          'relative mb-2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
          'hover:bg-[var(--bg-hover)]',
          isRunning && 'bg-emerald-500/[0.08]',
          !isRunning && errorCount > 0 && 'bg-amber-500/[0.08]',
        )}
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            isRunning && 'bg-emerald-500 tool-status-live-dot--solid',
            !isRunning && runState.status === 'failed' && 'bg-amber-500/80',
            !isRunning && runState.status !== 'failed' && errorCount > 0 && 'bg-amber-500/60',
            !isRunning && runState.status !== 'failed' && errorCount === 0 && 'bg-foreground-secondary/25',
          )}
        />
        {isRunning && (
          <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-emerald-500/20" />
        )}
      </button>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden px-1">
        {panels.map((panel) => {
          const Icon = panel.icon
          const active = activePanel === panel.key
          return (
            <button
              key={panel.key}
              type="button"
              title={panel.label}
              onClick={() => openPanel(panel.key)}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                active
                  ? 'bg-[var(--bg-active)] text-foreground'
                  : 'text-foreground-secondary/70 hover:bg-[var(--bg-hover)] hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          )
        })}
      </div>

      <button
        type="button"
        title="Expand right panel"
        onClick={() => toggleRightPanel()}
        className="chrome-icon-btn mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary"
      >
        <PanelRightOpen className="h-3.5 w-3.5" />
      </button>
    </aside>
  )
}
