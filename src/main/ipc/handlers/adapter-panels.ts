import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { resolveSidePanelState } from '../../side-panel-registry'
import { probeExtensions } from '../../../extension-compat/extension-probe'
import { loadAdapterCatalog, invalidateAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { readAdapterConfig, writeAdapterConfig, runAdapterAction, fetchFieldOptions } from '../../../extension-compat/adapter-backend'
import { listAdapterSidePanelMetas } from '../../../extension-compat/side-panel-catalog'
import {
  mergeRightPanelCatalog,
  defaultRightPanelPrefsForCatalog,
  normalizeRightPanelPrefs,
  normalizeRightPanelOrder,
} from '@shared/right-panels'

export function registerAdapterPanelHandlers(): void {
  registerHandler('ipc:adapter.config.get', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { view: readAdapterConfig(req.adapterId, workspaceId) }
  })

  registerHandler('ipc:adapter.config.set', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { view: writeAdapterConfig(req.adapterId, workspaceId, req.patch || {}) }
  })

  registerHandler('ipc:adapter.action.run', async (req) => runAdapterAction(req.adapterId, req.actionId))

  registerHandler('ipc:adapter.field.options', async (req) => fetchFieldOptions(req.adapterId, req.fieldKey))

  registerHandler('ipc:adapters.json.catalog', async (req) => {
    if (req?.refresh) invalidateAdapterCatalog()
    const cwd = workerManager.cwd || configStore.get('currentProject') || ''
    return loadAdapterCatalog(cwd)
  })

  registerHandler('ipc:rightPanels.catalog', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const probed = probeExtensions(cwd)
    const installedNames = new Set(probed.flatMap((p) => [p.name, p.packageName].filter(Boolean) as string[]))
    const adapterPanels = listAdapterSidePanelMetas(cwd, installedNames)
    const catalog = mergeRightPanelCatalog(adapterPanels)
    const stored = configStore.get('rightPanelPrefs')
    const prefs = normalizeRightPanelPrefs(stored, catalog)
    const order = normalizeRightPanelOrder(configStore.get('rightPanelOrder'), catalog)
    return {
      catalog,
      adapterPanels,
      prefs,
      order,
      defaultPrefs: defaultRightPanelPrefsForCatalog(catalog, adapterPanels),
    }
  })

  registerHandler('ipc:rightPanels.saveLayout', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const probed = probeExtensions(cwd)
    const installedNames = new Set(probed.flatMap((p) => [p.name, p.packageName].filter(Boolean) as string[]))
    const adapterPanels = listAdapterSidePanelMetas(cwd, installedNames)
    const catalog = mergeRightPanelCatalog(adapterPanels)
    const prefs = normalizeRightPanelPrefs(req?.prefs, catalog)
    const order = normalizeRightPanelOrder(req?.order, catalog)
    configStore.setRightPanelLayout(prefs, order)
    return { ok: true, prefs, order }
  })

  registerHandler('ipc:adapter.sidePanel.getState', async (req) => {
    const fallback = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const cwd = (req.workspaceId && String(req.workspaceId).trim()) || fallback
    const adapterId = String(req.adapterId || '').trim()
    if (!adapterId) return { ok: false, error: 'adapter_id_required', state: null }
    const r = resolveSidePanelState(adapterId, cwd, cwd)
    if (!r.ok) return { ok: false, error: r.error, state: null }
    return { ok: true, state: r.state }
  })
}