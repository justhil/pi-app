import { registerHandler, sendEvent } from '../registry'
import { BrowserWindow } from 'electron'
import { awaitWslVm } from '../../wsl/wsl-env'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { resolveSidePanelState } from '../../side-panel-registry'
import { probeExtensionsShared } from '../../extension-probe-cache'
import { prepareAdapterCatalog, onAdapterCatalogChanged, loadAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { readAdapterConfig, writeAdapterConfig, runAdapterAction, fetchFieldOptions } from '../../../extension-compat/adapter-backend'
import { listAdapterSidePanelMetas } from '../../../extension-compat/side-panel-catalog'
import {
  mergeRightPanelCatalog,
  defaultRightPanelPrefsForCatalog,
  normalizeRightPanelPrefs,
  normalizeRightPanelOrder,
} from '@shared/right-panels'

export function registerAdapterPanelHandlers(): void {
  onAdapterCatalogChanged((catalog, workspaceId) => {
    for (const window of BrowserWindow.getAllWindows()) sendEvent(window, { type: 'adapter-catalog-changed', workspaceId, revision: catalog.revision })
    void workerManager.refreshAdapters(workspaceId, catalog).catch((error) => console.warn('[adapter-catalog] worker refresh failed:', error))
  })
  registerHandler('ipc:adapter.config.get', async (req) => {
    const workspaceId = req.workspaceId ?? configStore.get('currentProject') ?? ''
    await awaitWslVm()
    return { view: await readAdapterConfig(req.adapterId, workspaceId) }
  })

  registerHandler('ipc:adapter.config.set', async (req) => {
    const workspaceId = req.workspaceId ?? configStore.get('currentProject') ?? ''
    await awaitWslVm()
    return { view: await writeAdapterConfig(req.adapterId, workspaceId, req.patch || {}) }
  })

  registerHandler('ipc:adapter.action.run', async (req) => {
    await awaitWslVm()
    const cwd = req.workspaceId ?? configStore.get('currentProject') ?? ''
    return runAdapterAction(req.adapterId, req.actionId, cwd)
  })

  registerHandler('ipc:adapter.field.options', async (req) => {
    await awaitWslVm()
    const cwd = req.workspaceId ?? configStore.get('currentProject') ?? ''
    return fetchFieldOptions(req.adapterId, req.fieldKey, cwd)
  })

  registerHandler('ipc:adapters.json.catalog', async (req) => {
    await awaitWslVm() // startup: let the WSL VM boot off-thread before sync \\wsl.localhost reads
    const cwd = req?.workspaceId ?? configStore.get('currentProject') ?? ''
    const catalog = await prepareAdapterCatalog(cwd, { refresh: req?.refresh === true })
    if (req?.refresh) await workerManager.refreshAdapters(cwd, catalog)
    return catalog
  })

  registerHandler('ipc:rightPanels.catalog', async (req) => {
    await awaitWslVm()
    const cwd = req?.workspaceId ?? configStore.get('currentProject') ?? process.cwd()
    await prepareAdapterCatalog(cwd)
    const needsInstalled = loadAdapterCatalog(cwd).adapters.some((adapter) => adapter.sidePanel && adapter.kind !== 'desktop' && !adapter.alwaysVisible)
    const probed = needsInstalled ? await probeExtensionsShared(cwd) : []
    const installedNames = new Set(probed.filter((probe) => probe.enabled).flatMap((p) => [p.name, p.packageName].filter(Boolean) as string[]))
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
    await awaitWslVm()
    const cwd = req?.workspaceId ?? configStore.get('currentProject') ?? process.cwd()
    await prepareAdapterCatalog(cwd)
    const needsInstalled = loadAdapterCatalog(cwd).adapters.some((adapter) => adapter.sidePanel && adapter.kind !== 'desktop' && !adapter.alwaysVisible)
    const probed = needsInstalled ? await probeExtensionsShared(cwd) : []
    const installedNames = new Set(probed.filter((probe) => probe.enabled).flatMap((p) => [p.name, p.packageName].filter(Boolean) as string[]))
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
    await awaitWslVm()
    const r = await resolveSidePanelState(adapterId, cwd, cwd)
    if (!r.ok) return { ok: false, error: r.error, state: null }
    return { ok: true, state: r.state }
  })
}