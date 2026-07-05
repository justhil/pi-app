/** 右侧栏 Tab：核心栏目 + 适配器声明的 sidePanel（合并后用于 Tab / 设置开关） */

export const CORE_RIGHT_PANEL_IDS = ['review', 'run', 'context', 'tree', 'files'] as const

export type CoreRightPanelId = (typeof CORE_RIGHT_PANEL_IDS)[number]

/** @deprecated 使用合并目录后的 panel id（含 adapter:xxx） */
export const RIGHT_PANEL_IDS = CORE_RIGHT_PANEL_IDS
export type RightPanelId = CoreRightPanelId | string

export interface RightPanelCatalogItem {
  id: string
  labelKey?: string
  fallbackLabel: string
  description: string
  descriptionKey?: string
  /** lucide 图标名；适配器栏目必填 */
  icon?: string
  source: 'core' | 'adapter'
  adapterId?: string
  /** 渲染器键，见 renderer side-panel-registry */
  panelComponent?: string
}

export const CORE_RIGHT_PANEL_CATALOG: RightPanelCatalogItem[] = [
  { id: 'review', labelKey: 'panel.review', fallbackLabel: 'Review', description: 'Git changes & diff (read-only)', descriptionKey: 'panel.reviewDesc', icon: 'GitBranch', source: 'core' },
  { id: 'run', labelKey: 'panel.run', fallbackLabel: 'Run', description: 'Current turn status & usage', descriptionKey: 'panel.runDesc', icon: 'Activity', source: 'core' },
  { id: 'context', labelKey: 'panel.context', fallbackLabel: 'Context', description: 'Session context preview', descriptionKey: 'panel.contextDesc', icon: 'FileSearch', source: 'core' },
  { id: 'tree', labelKey: 'panel.tree', fallbackLabel: 'Tree', description: 'Session tree / rewind (like /tree)', descriptionKey: 'panel.treeDesc', icon: 'GitBranch', source: 'core' },
  { id: 'files', labelKey: 'panel.files', fallbackLabel: 'Files', description: 'Workspace file preview & explorer', descriptionKey: 'panel.filesDesc', icon: 'FolderTree', source: 'core' },
]

/** @deprecated */
export const RIGHT_PANEL_CATALOG = CORE_RIGHT_PANEL_CATALOG

export type RightPanelPrefs = Record<string, boolean>

export function defaultCoreRightPanelPrefs(): RightPanelPrefs {
  const p: RightPanelPrefs = {}
  for (const id of CORE_RIGHT_PANEL_IDS) p[id] = true
  return p
}

/** @deprecated */
export function defaultRightPanelPrefs(): RightPanelPrefs {
  return defaultCoreRightPanelPrefs()
}

export interface AdapterSidePanelMeta {
  adapterId: string
  panelId: string
  label: string
  description?: string
  icon?: string
  panelComponent: string
  defaultEnabled?: boolean
}

/** 核心目录 + 适配器 sidePanel 声明（同 id 时适配器可覆盖文案，不重复插入） */
export function mergeRightPanelCatalog(adapterPanels: AdapterSidePanelMeta[]): RightPanelCatalogItem[] {
  const byId = new Map<string, RightPanelCatalogItem>()
  for (const c of CORE_RIGHT_PANEL_CATALOG) byId.set(c.id, { ...c })

  for (const a of adapterPanels) {
    const existing = byId.get(a.panelId)
    if (existing) {
      byId.set(a.panelId, {
        ...existing,
        fallbackLabel: a.label || existing.fallbackLabel,
        description: a.description || existing.description,
        icon: a.icon || existing.icon,
        panelComponent: a.panelComponent || existing.panelComponent,
        adapterId: a.adapterId,
      })
      continue
    }
    byId.set(a.panelId, {
      id: a.panelId,
      fallbackLabel: a.label,
      description: a.description || '',
      icon: a.icon || 'PanelRight',
      source: 'adapter',
      adapterId: a.adapterId,
      panelComponent: a.panelComponent,
    })
  }

  const core = CORE_RIGHT_PANEL_CATALOG.map((c) => byId.get(c.id)!)
  const extra = adapterPanels
    .map((a) => a.panelId)
    .filter((id) => !CORE_RIGHT_PANEL_IDS.includes(id as CoreRightPanelId))
    .map((id) => byId.get(id)!)
    .filter(Boolean)
  return [...core, ...extra]
}

export function catalogPanelIds(catalog: RightPanelCatalogItem[]): string[] {
  return catalog.map((c) => c.id)
}

/** 与 catalog 对齐的 Tab 顺序；未知 id 追加在末尾 */
export function normalizeRightPanelOrder(raw: unknown, catalog: RightPanelCatalogItem[]): string[] {
  const ids = catalogPanelIds(catalog)
  const known = new Set(ids)
  const out: string[] = []
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string' && known.has(x) && !out.includes(x)) out.push(x)
    }
  }
  for (const id of ids) {
    if (!out.includes(id)) out.push(id)
  }
  return out
}

export function reorderPanelIds(order: string[], fromId: string, toIndex: number): string[] {
  const from = order.indexOf(fromId)
  if (from < 0) return order
  const next = order.filter((id) => id !== fromId)
  const clamped = Math.max(0, Math.min(toIndex, next.length))
  next.splice(clamped, 0, fromId)
  return next
}

export function defaultRightPanelPrefsForCatalog(catalog: RightPanelCatalogItem[], adapterPanels: AdapterSidePanelMeta[]): RightPanelPrefs {
  const prefs = defaultCoreRightPanelPrefs()
  for (const a of adapterPanels) {
    if (CORE_RIGHT_PANEL_IDS.includes(a.panelId as CoreRightPanelId)) continue
    prefs[a.panelId] = a.defaultEnabled !== false
  }
  return prefs
}

export function normalizeRightPanelPrefs(raw: unknown, catalog: RightPanelCatalogItem[]): RightPanelPrefs {
  const ids = catalogPanelIds(catalog)
  const defaults: RightPanelPrefs = {}
  for (const id of ids) defaults[id] = true

  if (!raw || typeof raw !== 'object') return defaults
  const o = raw as Record<string, unknown>
  const out = { ...defaults }
  for (const id of ids) {
    if (typeof o[id] === 'boolean') out[id] = o[id]
    // 迁移：旧核心 trellis 开关 → 适配器栏目 adapter:trellis
    if (id === 'adapter:trellis' && typeof o.trellis === 'boolean' && typeof o[id] !== 'boolean') {
      out[id] = o.trellis
    }
  }
  const anyOn = ids.some((id) => out[id])
  if (!anyOn) {
    for (const id of ids) out[id] = true
  }
  return out
}

export function firstEnabledPanel(
  prefs: RightPanelPrefs,
  catalog: RightPanelCatalogItem[],
  order?: string[],
): string {
  const seq = order?.length ? normalizeRightPanelOrder(order, catalog) : catalogPanelIds(catalog)
  const id = seq.find((pid) => prefs[pid])
  return id ?? 'review'
}

export function coerceActivePanel(
  active: string,
  prefs: RightPanelPrefs,
  catalog: RightPanelCatalogItem[],
  order?: string[],
): string {
  const ids = new Set(catalogPanelIds(catalog))
  const a = active === 'trellis' && ids.has('adapter:trellis') ? 'adapter:trellis' : active
  if (ids.has(a) && prefs[a]) return a
  return firstEnabledPanel(prefs, catalog, order)
}