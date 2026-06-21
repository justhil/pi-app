import type { LucideIcon } from 'lucide-react'
import { GitBranch, ListTree, Activity, FileSearch, Radio } from 'lucide-react'
import { RIGHT_PANEL_CATALOG, type RightPanelId } from '@shared/right-panels'

const ICONS: Record<RightPanelId, LucideIcon> = {
  review: GitBranch,
  trellis: ListTree,
  run: Activity,
  context: FileSearch,
  intercom: Radio,
  tree: GitBranch,
}

export function buildRightPanelTabs(t: (key: string) => string) {
  return RIGHT_PANEL_CATALOG.map((item) => ({
    key: item.id,
    label: t(item.labelKey, { defaultValue: item.fallbackLabel }),
    icon: ICONS[item.id],
  }))
}