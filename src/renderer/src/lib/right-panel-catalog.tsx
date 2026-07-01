import type { LucideIcon } from 'lucide-react'
import {
  GitBranch,
  ListTree,
  Activity,
  FileSearch,
  PanelRight,
} from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import type { RightPanelCatalogItem } from '@shared/right-panels'

const CORE_ICONS: Record<string, LucideIcon> = {
  review: GitBranch,
  run: Activity,
  context: FileSearch,
  tree: GitBranch,
}

function resolveIcon(name?: string): LucideIcon {
  if (!name) return PanelRight
  const fromCore = CORE_ICONS[name]
  if (fromCore) return fromCore
  const icon = (LucideIcons as Record<string, LucideIcon>)[name]
  return icon || PanelRight
}

export function buildRightPanelTabs(
  catalog: RightPanelCatalogItem[],
  prefs: Record<string, boolean>,
  t: (key: string, opts?: { defaultValue?: string }) => string,
  order?: string[],
) {
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const seq = order?.length
    ? order.map((id) => byId.get(id)).filter((x): x is RightPanelCatalogItem => !!x)
    : catalog
  return seq
    .filter((item) => prefs[item.id])
    .map((item) => ({
      key: item.id,
      label: item.labelKey ? t(item.labelKey, { defaultValue: item.fallbackLabel }) : item.fallbackLabel,
      icon: resolveIcon(item.icon || item.id),
      catalogItem: item,
    }))
}