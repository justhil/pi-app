import {
  Activity,
  FileSearch,
  FolderTree,
  GitBranch,
  Globe,
  ListTree,
  Network,
  PanelRight,
  normalizeLegacyIconName,
  resolveAppIcon,
  type AppIconComponent,
  type AppIconName,
} from '@renderer/components/icons'
import type { RightPanelCatalogItem } from '@shared/right-panels'

/** Core panel ids resolve directly; adapter names share the legacy semantic resolver. */
const CORE_PANEL_ICONS: Record<string, AppIconComponent> = {
  review: GitBranch,
  run: Activity,
  context: FileSearch,
  tree: ListTree,
  files: FolderTree,
  browser: Globe,
  intercom: Network,
}

export function resolveRightPanelIconName(name?: string): AppIconName {
  return normalizeLegacyIconName(name) ?? 'panel-right'
}

function resolveIcon(name?: string): AppIconComponent {
  return (name && CORE_PANEL_ICONS[name]) || resolveAppIcon(resolveRightPanelIconName(name)) || PanelRight
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
