import { lazy, type ComponentType } from 'react'
import { GenericAdapterSidePanel } from './generic-adapter-side-panel'
import { WorkspaceTasksSidePanel } from './workspace-tasks-side-panel'

export type SidePanelComponentProps = {
  panelId: string
  adapterId?: string
  panelComponent: string
  title?: string
}

const LazyReview = lazy(() => import('@renderer/features/review/review-panel').then((m) => ({ default: m.ReviewPanel })))
const LazyRun = lazy(() => import('@renderer/features/run/run-panel').then((m) => ({ default: m.RunPanel })))
const LazyContext = lazy(() => import('@renderer/features/context/context-panel').then((m) => ({ default: m.ContextPanel })))
const LazyIntercom = lazy(() => import('@renderer/features/intercom/intercom-panel').then((m) => ({ default: m.IntercomPanel })))
const LazyTree = lazy(() => import('@renderer/features/rewind/tree-panel').then((m) => ({ default: m.TreePanel })))

const CORE_BY_ID: Record<string, ComponentType<SidePanelComponentProps>> = {
  review: () => <LazyReview />,
  run: () => <LazyRun />,
  context: () => <LazyContext />,
  intercom: () => <LazyIntercom />,
  tree: () => <LazyTree />,
}

const BY_COMPONENT: Record<string, ComponentType<SidePanelComponentProps>> = {
  'workspace-tasks': WorkspaceTasksSidePanel,
  'generic-json': GenericAdapterSidePanel,
}

export function renderSidePanel(item: {
  id: string
  panelComponent?: string
  adapterId?: string
}): ComponentType<SidePanelComponentProps> | null {
  const comp = item.panelComponent || item.id
  if (BY_COMPONENT[comp]) return BY_COMPONENT[comp]
  if (CORE_BY_ID[item.id]) return CORE_BY_ID[item.id]
  if (item.adapterId) return GenericAdapterSidePanel
  return null
}