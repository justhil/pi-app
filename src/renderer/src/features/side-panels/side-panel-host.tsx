import { Suspense, lazy } from 'react'
import type { RightPanelCatalogItem } from '@shared/right-panels'
import { GenericAdapterSidePanel } from './generic-adapter-side-panel'
import { WorkspaceTasksSidePanel } from './workspace-tasks-side-panel'

const ReviewPanel = lazy(() => import('@renderer/features/review/review-panel').then((m) => ({ default: m.ReviewPanel })))
const RunPanel = lazy(() => import('@renderer/features/run/run-panel').then((m) => ({ default: m.RunPanel })))
const ContextPanel = lazy(() => import('@renderer/features/context/context-panel').then((m) => ({ default: m.ContextPanel })))
const IntercomPanel = lazy(() => import('@renderer/features/intercom/intercom-panel').then((m) => ({ default: m.IntercomPanel })))
const TreePanel = lazy(() => import('@renderer/features/rewind/tree-panel').then((m) => ({ default: m.TreePanel })))

const ADAPTER_PANEL_COMPONENTS: Record<string, React.ComponentType<import('./side-panel-registry').SidePanelComponentProps>> = {
  'workspace-tasks': WorkspaceTasksSidePanel,
  'generic-json': GenericAdapterSidePanel,
}

export function SidePanelHost({ item }: { item: RightPanelCatalogItem | undefined }) {
  if (!item) return null
  const wrap = (node: React.ReactNode) => <Suspense fallback={null}>{node}</Suspense>

  if (item.adapterId) {
    const comp = item.panelComponent || 'generic-json'
    const Panel = ADAPTER_PANEL_COMPONENTS[comp] || GenericAdapterSidePanel
    return (
      <Panel
        panelId={item.id}
        adapterId={item.adapterId}
        panelComponent={comp}
        title={item.fallbackLabel}
      />
    )
  }

  if (item.id === 'review') return wrap(<ReviewPanel />)
  if (item.id === 'run') return wrap(<RunPanel />)
  if (item.id === 'context') return wrap(<ContextPanel />)
  if (item.id === 'intercom') return wrap(<IntercomPanel />)
  if (item.id === 'tree') return wrap(<TreePanel />)

  return <div className="p-4 text-[12px] text-muted-foreground">未注册面板: {item.id}</div>
}