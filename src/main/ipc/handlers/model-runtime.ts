import { app } from 'electron'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { isSandboxWorkspacePath } from '../../sandbox-workspaces'
import { readModelsConfigRaw, modelsCatalogFromConfig } from '../../pi-models-json'
import { getActiveSdkModule } from '../sdk-session'
import { getSessionContextPreviewFromDisk } from '../../session-context-preview'
import { getSessionLeafOverride } from '../../session-leaf-override'
import { authorizeTrustedSessionFile } from '../../trusted-workspace'
import { isWslRuntimeActive } from '../../wsl/runtime-config'
import { contextPreviewSchema } from '../schemas'
import {
  listAvailableModelsWithSdk,
  listCatalogModelsWithSdk,
  resolveAvailableModels,
  resolveCatalogModels,
} from '../../active-sdk-models'

export function registerModelRuntimeHandlers(): void {
  registerHandler('ipc:model.list', async (req) => {
    const scope = req?.scope === 'available' ? 'available' : 'catalog'
    const mapRegistry = (models: readonly { id: string; name?: string; provider?: string; contextWindow?: number; maxOutput?: number; maxTokens?: number }[]) =>
      models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider,
        contextWindow: m.contextWindow || 0,
        maxOutput: m.maxOutput || m.maxTokens || 0,
        available: true,
      }))

    const catalogFromDisk = () => {
      const { config, parseError } = readModelsConfigRaw()
      if (parseError) return { models: [] as ReturnType<typeof mapRegistry> }
      return { models: modelsCatalogFromConfig(config) }
    }

    if (scope === 'catalog') {
      const models = await resolveCatalogModels({
        sdk: async () => mapRegistry(await listCatalogModelsWithSdk(await getActiveSdkModule(app.getPath('userData')))),
        catalog: () => catalogFromDisk().models,
        onSdkError: (error) => console.error('[IPC] model.list catalog failed:', error),
      })
      return { models }
    }

    const models = await resolveAvailableModels({
      worker: workerManager.isRunning
        ? async () =>
            mapRegistry(
              (await workerManager.getModels()).filter(
                (model): model is typeof model & { id: string } => typeof model.id === 'string',
              ),
            )
        : undefined,
      sdk: async () => mapRegistry(await listAvailableModelsWithSdk(await getActiveSdkModule(app.getPath('userData')))),
      onWorkerError: (error) => console.error('[IPC] model.list worker failed:', error),
      onSdkError: (error) => console.error('[IPC] model.list failed:', error),
    })
    return { models }
  })

  registerHandler('ipc:model.set', async (req) => {
    const sessionFile = String(req.sessionFile || '').trim() || undefined
    let provider: string
    let modelId: string
    if (req.provider && req.modelId) {
      provider = req.provider
      modelId = req.modelId
    } else {
      const raw = req.modelId || ''
      const separator = raw.indexOf('/')
      if (separator >= 0) {
        provider = raw.slice(0, separator)
        modelId = raw.slice(separator + 1)
      } else {
        provider = 'anthropic'
        modelId = raw
      }
    }
    if (!workerManager.isRunning && !sessionFile) {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (!cwd || isSandboxWorkspacePath(cwd)) throw new Error('Worker not started')
      await workerManager.start(cwd)
    }
    const actualModel = await workerManager.setModel(provider, modelId, sessionFile)
    return { modelId: actualModel }
  })

  registerHandler('ipc:model.cycle', async () => ({ modelId: '', thinkingLevel: 'medium' }))

  registerHandler('ipc:thinkingLevel.set', async (req) => {
    const sessionFile = String(req.sessionFile || '').trim() || undefined
    if (!workerManager.isRunning && !sessionFile) {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (!cwd || isSandboxWorkspacePath(cwd)) throw new Error('Worker not started')
      await workerManager.start(cwd)
    }
    await workerManager.setThinkingLevel(req.level, sessionFile)
    return { level: req.level }
  })

  registerHandler('ipc:runtime.getState', async (req) => {
    const workspaceId = String(req?.workspaceId || '').trim()
    const sessionFile = String(req?.sessionFile || '').trim()
    if (sessionFile) {
      try {
        return { state: await workerManager.getState(sessionFile) }
      } catch {
        return { state: null }
      }
    }
    if (workspaceId && workspaceId !== workerManager.cwd) {
      const bg = await workerManager.getBackgroundRuntimeState(workspaceId)
      return { state: bg }
    }
    if (!workerManager.isRunning) return { state: null }
    return { state: await workerManager.getState() }
  })

  registerHandlerWithSchema('ipc:context.preview', contextPreviewSchema, async (req) => {
    const { sessionFile, workspaceId } = req
    const authorized = authorizeTrustedSessionFile(workspaceId, sessionFile)
    if (!authorized.ok) return { preview: null }

    if (workerManager.isRunning) {
      try {
        const preview = await workerManager.getSessionContextPreview(authorized.sessionFile)
        if (preview) return { preview }
      } catch (e) {
        console.warn('[IPC] live context.preview failed, using disk:', e)
      }
    }
    if (isWslRuntimeActive()) return { preview: null }

    try {
      return {
        preview: await getSessionContextPreviewFromDisk(
          authorized.sessionFile,
          getSessionLeafOverride(authorized.sessionFile),
        ),
      }
    } catch (e) {
      console.error('[IPC] context.preview failed:', e)
      return { preview: null }
    }
  })
}
