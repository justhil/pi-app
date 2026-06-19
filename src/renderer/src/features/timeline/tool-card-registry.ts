// Tool card registry (兼容层 v2 工具卡查表层 — docs/adapter-layer-plan.md §4.2/§7)
// 完全 v2：工具→模板解析走 adapter catalog（findAdapterByTool），无插件名硬编码。
// 模板渲染器在 tool-card-templates.tsx（list/media/tree/kv/default）。
// 渲染器都是通用的，由 adapter.toolCard.template 声明调用，不含插件专属逻辑。
import { useEffect, useState } from 'react'
import type { AdapterJson, ToolCardTemplate } from '../../../../extension-compat/adapter-schema'
import { ipcClient } from '@renderer/lib/ipc-client'

let cachedCatalog: AdapterJson[] | null = null
let loadingPromise: Promise<AdapterJson[]> | null = null

async function loadCatalog(): Promise<AdapterJson[]> {
  if (cachedCatalog) return cachedCatalog
  if (loadingPromise) return loadingPromise
  loadingPromise = ipcClient
    .invoke('adapters.json.catalog')
    .then((res) => {
      cachedCatalog = (res?.adapters || []) as AdapterJson[]
      return cachedCatalog
    })
    .catch(() => {
      cachedCatalog = []
      return cachedCatalog
    })
  return loadingPromise
}

// Eagerly start loading on module init
loadCatalog()

export function invalidateToolCardCatalog(): void {
  cachedCatalog = null
  loadingPromise = null
}

/** Resolve adapter for a tool name from the v2 catalog. */
export function resolveAdapterForTool(toolName: string): AdapterJson | undefined {
  if (!cachedCatalog) return undefined
  return cachedCatalog.find((a) => a.match?.tools?.includes(toolName))
}

/** Resolve the tool card template for a tool name. Returns undefined => default renderer. */
export function resolveToolCardTemplate(toolName: string | undefined): ToolCardTemplate | undefined {
  if (!toolName) return undefined
  return resolveAdapterForTool(toolName)?.toolCard?.template
}

/** Resolve full adapter.toolCard def for a tool. */
export function resolveToolCardDef(toolName: string | undefined): AdapterJson['toolCard'] | undefined {
  if (!toolName) return undefined
  return resolveAdapterForTool(toolName)?.toolCard
}

/** Hook: ensure catalog is loaded (triggers re-render once available). */
export function useToolCardCatalogReady(): boolean {
  const [ready, setReady] = useState(!!cachedCatalog)
  useEffect(() => {
    if (cachedCatalog) return
    loadCatalog().then(() => setReady(true))
  }, [])
  return ready
}
