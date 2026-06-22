// 从 adapter.json sidePanel 生成右栏目录元数据（Main / Renderer 共用逻辑）

import type { AdapterSidePanelMeta } from '../../packages/shared/right-panels'
import { loadAdapterCatalog } from './adapter-loader'
import type { AdapterJson } from './adapter-schema'

export function adapterSidePanelMetaFromJson(a: AdapterJson): AdapterSidePanelMeta | null {
  const sp = a.sidePanel
  if (!sp?.stateProvider || !sp.panelComponent) return null
  const panelId = sp.panelId || `adapter:${a.id}`
  return {
    adapterId: a.id,
    panelId,
    label: sp.label || a.displayName || a.id,
    description: sp.description || a.description,
    icon: sp.icon,
    panelComponent: sp.panelComponent,
    defaultEnabled: sp.defaultEnabled,
  }
}

/**
 * 列出右栏 adapter sidePanel 元数据。
 * onlyInstalled 传已安装插件名集合时，只返回 alwaysVisible 或已安装的适配器 sidePanel。
 */
export function listAdapterSidePanelMetas(
  projectDir?: string,
  installedNames?: Set<string>,
): AdapterSidePanelMeta[] {
  const catalog = loadAdapterCatalog(projectDir)
  const out: AdapterSidePanelMeta[] = []
  for (const a of catalog.adapters) {
    if (a.tier === 'none') continue
    if (!a.alwaysVisible && installedNames) {
      const names = (a.match?.names || []).map((n) => n.toLowerCase())
      const installed = [...installedNames].some((n) => {
        const nl = n.toLowerCase()
        return names.some((m) => nl === m || nl.endsWith(m) || nl.includes(m))
      })
      if (!installed) continue
    }
    const m = adapterSidePanelMetaFromJson(a)
    if (m) out.push(m)
  }
  return out
}