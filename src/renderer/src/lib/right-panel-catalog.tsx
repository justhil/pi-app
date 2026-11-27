import {
  Activity,
  FileSearch,
  FolderGit2,
  FolderTree,
  GitBranch,
  GitFork,
  Globe,
  Layers,
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
  canvas: Layers,
  worktrees: FolderGit2,
  github: GitFork,
  browser: Globe,
  intercom: Network,
}

export function resolveRightPanelIconName(name?: string): AppIconName {
  return normalizeLegacyIconName(name) ?? 'panel-right'
}

function resolveIcon(name?: string): AppIconComponent {
  return (name && CORE_PANEL_ICONS[name]) || resolveAppIcon(resolveRightPanelIconName(name)) || PanelRight
}

export function buildAllRightPanelTabs(
  catalog: RightPanelCatalogItem[],
  t: (key: string, opts?: { defaultValue?: string }) => string,
  order?: string[],
  excludeIds?: readonly string[],
) {
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const excluded = excludeIds?.length ? new Set(excludeIds) : null
  const seq: RightPanelCatalogItem[] = []
  const seen = new Set<string>()
  if (order?.length) {
    for (const id of order) {
      const item = byId.get(id)
      if (item && !seen.has(id)) {
        seen.add(id)
        seq.push(item)
      }
    }
  }
  for (const item of catalog) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      seq.push(item)
    }
  }
  return seq
    .filter((item) => !excluded?.has(item.id))
    .map((item) => ({
      key: item.id,
      label: item.labelKey ? t(item.labelKey, { defaultValue: item.fallbackLabel }) : item.fallbackLabel,
      icon: resolveIcon(item.icon || item.id),
      catalogItem: item,
    }))
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
