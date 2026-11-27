import { useMemo } from 'react'
import { PanelRightOpen } from '@renderer/components/icons'
import { isStageRightPanelId } from '@shared/right-panels'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { useRightDockStore } from '@renderer/stores/right-dock-store'
import { buildAllRightPanelTabs } from '@renderer/lib/right-panel-catalog'
import { useRightPanelHidden } from '@renderer/lib/use-right-panel-hidden'
import { useBrowserStore } from '@renderer/features/browser/browser-store'
import { selectVisibleSurfaces, useCanvasStore } from '@renderer/features/canvas/canvas-store'
import { useTranslation } from 'react-i18next'

export function RightPanelCollapsedRail() {
  const { t } = useTranslation()
  const collapsed = useRightPanelHidden()
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const rightPanelCatalog = useUIStore((s) => s.rightPanelCatalog)
  const rightPanelPrefs = useUIStore((s) => s.rightPanelPrefs)
  const rightPanelOrder = useUIStore((s) => s.rightPanelOrder)
  const attention = useUIStore((s) => s.sessionAttention)
  const openTabIds = useRightDockStore((s) => s.openTabIds)
  const activatePanelSmart = useRightDockStore((s) => s.activatePanelSmart)
  const closeTab = useRightDockStore((s) => s.closeTab)
  const browserTabCount = useBrowserStore((s) => s.order.length)
  const browserAgentBusy = useBrowserStore((s) => Boolean(s.agentAction))
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const canvasSurfaces = useCanvasStore((s) => s.surfaces)
  const canvasSurfaceCount = selectVisibleSurfaces(canvasSurfaces, historySessionFile, false).length

  const attentionAlert = Object.values(attention).some(
    (value) => value === 'needs-you' || value === 'done',
  )

  const openIdSet = useMemo(() => new Set(openTabIds), [openTabIds])

  const railPanels = useMemo(() => {
    const all = buildAllRightPanelTabs(rightPanelCatalog, t, rightPanelOrder)
    return all.filter((item) => rightPanelPrefs[item.key] || openIdSet.has(item.key))
  }, [rightPanelCatalog, rightPanelPrefs, rightPanelOrder, openIdSet, t])

  const stagePanels = useMemo(() => railPanels.filter((p) => isStageRightPanelId(p.key)), [railPanels])
  const inspectorPanels = useMemo(() => railPanels.filter((p) => !isStageRightPanelId(p.key)), [railPanels])

  if (!collapsed) return null

  const openPanel = (panelKey: string) => {
    activatePanelSmart(panelKey)
    useUIStore.getState().revealRightPanel()
  }

  const expandDefault = () => {
    if (openTabIds.length === 0) {
      const firstKey = stagePanels[0]?.key ?? inspectorPanels[0]?.key ?? 'canvas'
      activatePanelSmart(firstKey)
    }
    toggleRightPanel()
  }

  const renderRailButton = (panel: (typeof railPanels)[number]) => {
    const Icon = panel.icon
    const isOpen = openIdSet.has(panel.key)
    const dot =
      panel.key === 'browser' && (browserTabCount > 0 || browserAgentBusy)
        ? browserAgentBusy
          ? 'bg-[var(--brand)] animate-pulse'
          : 'bg-[var(--brand)]'
        : panel.key === 'canvas' && canvasSurfaceCount > 0
          ? 'bg-[var(--brand)]/80'
          : attentionAlert && panel.key === 'run'
            ? 'bg-[color-mix(in_srgb,#c9a227_88%,white)]'
            : null

    return (
      <button
        key={panel.key}
        type="button"
        title={isOpen ? `${panel.label}（${t('common:panel.opened')} · ${t('common:panel.closeTab')}）` : panel.label}
        aria-label={panel.label}
        onClick={() => openPanel(panel.key)}
        onMouseDown={(e) => {
          if (e.button === 1 && isOpen) e.preventDefault()
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && isOpen) {
            e.preventDefault()
            closeTab(panel.key)
          }
        }}
        className={cn(
          'group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
          isOpen
            ? 'bg-foreground/[0.07] text-foreground'
            : 'text-foreground-secondary/65 hover:bg-foreground/[0.05] hover:text-foreground',
        )}
      >
        {isOpen ? (
          <span
            className="absolute right-0 top-2 bottom-2 w-[2px] rounded-full bg-[var(--brand)]"
            aria-hidden
          />
        ) : null}
        <Icon className="h-[15px] w-[15px]" strokeWidth={1.65} />
        {dot ? <span className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', dot)} /> : null}
      </button>
    )
  }

  return (
    <aside
      data-pi-slot="right-collapsed-rail"
      className="right-collapsed-rail electron-no-drag flex h-full w-10 shrink-0 flex-col items-center py-2.5"
      style={{ background: 'var(--surface-sidebar)' }}
      aria-label={t('common:topbar.expandRightPanel')}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden px-1">
        {stagePanels.map(renderRailButton)}
        {stagePanels.length > 0 && inspectorPanels.length > 0 ? (
          <div className="my-1 h-px w-4 shrink-0 bg-border/55" aria-hidden />
        ) : null}
        {inspectorPanels.map(renderRailButton)}
      </div>

      <button
        type="button"
        title={t('common:topbar.expandRightPanel')}
        aria-label={t('common:topbar.expandRightPanel')}
        onClick={expandDefault}
        className="chrome-icon-btn mt-1 flex h-7 w-7 items-center justify-center rounded-lg text-foreground-secondary/65 hover:text-foreground"
      >
        <PanelRightOpen className="h-3.5 w-3.5" />
      </button>
    </aside>
  )
}
