/** 右侧栏 Tab 目录（设置页可开关显示） */

export const RIGHT_PANEL_IDS = [
  'review',
  'trellis',
  'run',
  'context',
  'intercom',
  'tree',
] as const

export type RightPanelId = (typeof RIGHT_PANEL_IDS)[number]

export interface RightPanelCatalogItem {
  id: RightPanelId
  /** i18n key 或直显文案 */
  labelKey: string
  fallbackLabel: string
  description: string
}

export const RIGHT_PANEL_CATALOG: RightPanelCatalogItem[] = [
  { id: 'review', labelKey: 'panel.review', fallbackLabel: 'Review', description: 'Git 变更与 diff（只读）' },
  { id: 'trellis', labelKey: 'panel.trellis', fallbackLabel: 'Trellis', description: '任务与阶段（只读）' },
  { id: 'run', labelKey: 'panel.run', fallbackLabel: 'Run', description: '当前轮次状态与用量' },
  { id: 'context', labelKey: 'panel.context', fallbackLabel: 'Context', description: '会话上下文预览' },
  { id: 'intercom', labelKey: 'panel.intercom', fallbackLabel: 'Intercom', description: '本机多会话协调' },
  { id: 'tree', labelKey: 'panel.tree', fallbackLabel: 'Tree', description: '会话树 / 回退（同 /tree）' },
]

export type RightPanelPrefs = Record<RightPanelId, boolean>

export function defaultRightPanelPrefs(): RightPanelPrefs {
  return {
    review: true,
    trellis: true,
    run: true,
    context: true,
    intercom: true,
    tree: true,
  }
}

export function normalizeRightPanelPrefs(raw: unknown): RightPanelPrefs {
  const base = defaultRightPanelPrefs()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  for (const id of RIGHT_PANEL_IDS) {
    if (typeof o[id] === 'boolean') base[id] = o[id]
  }
  const anyOn = RIGHT_PANEL_IDS.some((id) => base[id])
  if (!anyOn) return defaultRightPanelPrefs()
  return base
}

export function firstEnabledPanel(prefs: RightPanelPrefs): RightPanelId {
  return RIGHT_PANEL_IDS.find((id) => prefs[id]) ?? 'review'
}

export function coerceActivePanel(active: string, prefs: RightPanelPrefs): RightPanelId {
  if (RIGHT_PANEL_IDS.includes(active as RightPanelId) && prefs[active as RightPanelId]) {
    return active as RightPanelId
  }
  return firstEnabledPanel(prefs)
}