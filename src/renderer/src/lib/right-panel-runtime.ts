import type { RightPanelCatalogItem, RightPanelPrefs } from '@shared/right-panels'
import {
  CORE_RIGHT_PANEL_CATALOG,
  mergeRightPanelCatalog,
  normalizeRightPanelPrefs,
  normalizeRightPanelOrder,
  defaultRightPanelPrefsForCatalog,
} from '@shared/right-panels'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

let cachedCatalog: RightPanelCatalogItem[] | null = null
let loadPromise: Promise<RightPanelCatalogItem[]> | null = null
let generation = 0

export async function loadRightPanelCatalog(): Promise<RightPanelCatalogItem[]> {
  if (cachedCatalog) return cachedCatalog
  if (loadPromise) return loadPromise
  const request = generation
  const workspaceId = useUIStore.getState().currentWorkspace || ''
  loadPromise = ipcClient
    .invoke('rightPanels.catalog', { workspaceId })
    .then((res) => {
      const catalog = (res?.catalog as RightPanelCatalogItem[]) || mergeRightPanelCatalog([])
      if (request === generation && workspaceId === (useUIStore.getState().currentWorkspace || '')) cachedCatalog = catalog
      return catalog
    })
    .catch(() => {
      const catalog = [...CORE_RIGHT_PANEL_CATALOG]
      if (request === generation && workspaceId === (useUIStore.getState().currentWorkspace || '')) cachedCatalog = catalog
      return catalog
    })
  return loadPromise
}

export function invalidateRightPanelCatalog(): void {
  generation++
  cachedCatalog = null
  loadPromise = null
}

export async function loadNormalizedRightPanelPrefs(): Promise<{
  catalog: RightPanelCatalogItem[]
  prefs: RightPanelPrefs
  order: string[]
}> {
  const request = generation
  const workspaceId = useUIStore.getState().currentWorkspace || ''
  const res = await ipcClient.invoke('rightPanels.catalog', { workspaceId }).catch(() => null)
  const catalog = (res?.catalog as RightPanelCatalogItem[]) || mergeRightPanelCatalog([])
  const prefs = normalizeRightPanelPrefs(res?.prefs ?? res?.settings?.rightPanelPrefs, catalog)
  const order = normalizeRightPanelOrder(res?.order, catalog)
  if (request === generation && workspaceId === (useUIStore.getState().currentWorkspace || '')) cachedCatalog = catalog
  return { catalog, prefs, order }
}

export function defaultPrefsForCatalog(catalog: RightPanelCatalogItem[]): RightPanelPrefs {
  return defaultRightPanelPrefsForCatalog(catalog, [])
}