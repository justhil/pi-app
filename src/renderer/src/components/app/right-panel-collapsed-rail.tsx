import { useMemo } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { buildRightPanelTabs } from '@renderer/lib/right-panel-catalog'
import { useTranslation } from 'react-i18next'

/**
 * Collapsed right rail: panel icons only (no run-status green pulse).
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

  return (
    <aside
      className="right-collapsed-rail electron-no-drag flex h-full w-10 shrink-0 flex-col items-center border-l border-border/40 py-2"
      style={{ background: 'color-mix(in srgb, var(--bg-base) 96%, var(--surface-sidebar))' }}
      aria-label={t('common:topbar.expandRightPanel')}
    >
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
        title={t('common:topbar.expandRightPanel')}
        onClick={() => toggleRightPanel()}
        className="chrome-icon-btn mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary"
      >
        <PanelRightOpen className="h-3.5 w-3.5" />
      </button>
    </aside>
  )
}
