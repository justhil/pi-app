import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BrainCircuit,
  Eye,
  FileSearch,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Hash,
  Image,
  Lightbulb,
  ListTree,
  MessageCircleQuestion,
  Network,
  PanelRight,
  Play,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react'
import type { RightPanelCatalogItem } from '@shared/right-panels'

/**
 * Explicit icon registry for core + known adapter panel icons.
 * Avoids `import * as LucideIcons` which ships the full namespace (~1MB).
 * Unknown names fall back to PanelRight.
 */
const SUPPORTED_PANEL_ICONS: Record<string, LucideIcon> = {
  // Core panel ids and Lucide component names used in CORE_RIGHT_PANEL_CATALOG
  review: GitBranch,
  run: Activity,
  context: FileSearch,
  tree: GitBranch,
  files: FolderTree,
  GitBranch,
  Activity,
  FileSearch,
  FolderTree,
  PanelRight,
  ListTree,
  Network,
  // Built-in adapter.json icon strings (PascalCase Lucide names)
  Globe,
  MessageCircleQuestion,
  Play,
  Eye,
  Search,
  Terminal,
  ShieldCheck,
  Hash,
  FileText,
  BrainCircuit,
  Scissors,
  Sparkles,
  Lightbulb,
  Image,
}

function resolveIcon(name?: string): LucideIcon {
  if (!name) return PanelRight
  return SUPPORTED_PANEL_ICONS[name] || PanelRight
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
