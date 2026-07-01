import type { RightPanelCatalogItem, RightPanelPrefs } from '@shared/right-panels'
import {
  CORE_RIGHT_PANEL_CATALOG,
  mergeRightPanelCatalog,
  normalizeRightPanelPrefs,
  normalizeRightPanelOrder,
  defaultRightPanelPrefsForCatalog,
} from '@shared/right-panels'
import { ipcClient } from '@renderer/lib/ipc-client'

let cachedCatalog: RightPanelCatalogItem[] | null = null
let loadPromise: Promise<RightPanelCatalogItem[]> | null = null

export async function loadRightPanelCatalog(): Promise<RightPanelCatalogItem[]> {
  if (cachedCatalog) return cachedCatalog
  if (loadPromise) return loadPromise
  loadPromise = ipcClient
    .invoke('rightPanels.catalog')
    .then((res) => {
      cachedCatalog = (res?.catalog as RightPanelCatalogItem[]) || mergeRightPanelCatalog([])
      return cachedCatalog
    })
    .catch(() => {
      cachedCatalog = [...CORE_RIGHT_PANEL_CATALOG]
      return cachedCatalog
    })
  return loadPromise
}

export function invalidateRightPanelCatalog(): void {
  cachedCatalog = null
  loadPromise = null
}

export async function loadNormalizedRightPanelPrefs(): Promise<{
  catalog: RightPanelCatalogItem[]
  prefs: RightPanelPrefs
  order: string[]
}> {
  const res = await ipcClient.invoke('rightPanels.catalog').catch(() => null)
  const catalog = (res?.catalog as RightPanelCatalogItem[]) || mergeRightPanelCatalog([])
  const prefs = normalizeRightPanelPrefs(res?.prefs ?? res?.settings?.rightPanelPrefs, catalog)
  const order = normalizeRightPanelOrder(res?.order, catalog)
  cachedCatalog = catalog
  return { catalog, prefs, order }
}

export function defaultPrefsForCatalog(catalog: RightPanelCatalogItem[]): RightPanelPrefs {
  return defaultRightPanelPrefsForCatalog(catalog, [])
}