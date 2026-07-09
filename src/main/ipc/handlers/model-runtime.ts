import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { isSandboxWorkspacePath } from '../../sandbox-workspaces'
import { readModelsConfigRaw, modelsCatalogFromConfig } from '../../pi-models-json'
import { getActiveSdkModule } from '../sdk-session'

export function registerModelRuntimeHandlers(): void {
  registerHandler('ipc:model.list', async (req) => {
    const scope = req?.scope === 'available' ? 'available' : 'catalog'
    const mapRegistry = (models: { id: string; name?: string; provider?: string; contextWindow?: number; maxOutput?: number; maxTokens?: number }[]) =>
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

    if (scope === 'catalog') return catalogFromDisk()

    if (workerManager.isRunning) {
      try {
        const models = await workerManager.getModels()
        if (models.length > 0) return { models }
      } catch (e) {
        console.error('[IPC] model.list worker failed:', e)
      }
    }
    try {
      const { ModelRegistry, AuthStorage } = await getActiveSdkModule()
      const auth = AuthStorage.create()
      const registry = ModelRegistry.create(auth)
      const models = await registry.getAvailable()
      if (models.length > 0) return { models: mapRegistry(models) }
    } catch (e) {
      console.error('[IPC] model.list failed:', e)
    }
    return catalogFromDisk()
  })

  registerHandler('ipc:model.set', async (req) => {
    let provider: string
    let modelId: string
    if (req.provider && req.modelId) {
      provider = req.provider
      modelId = req.modelId
    } else {
      const raw = req.modelId || ''
      if (raw.includes('/')) {
        ;[provider, modelId] = raw.split('/') as [string, string]
      } else {
        provider = 'anthropic'
        modelId = raw
      }
    }
    if (!workerManager.isRunning) {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (!cwd || isSandboxWorkspacePath(cwd)) throw new Error('Worker not started')
      await workerManager.start(cwd)
    }
    await workerManager.setModel(provider, modelId)
    return { modelId: `${provider}/${modelId}` }
  })

  registerHandler('ipc:model.cycle', async () => ({ modelId: '', thinkingLevel: 'medium' }))

  registerHandler('ipc:thinkingLevel.set', async (req) => {
    if (!workerManager.isRunning) {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (!cwd || isSandboxWorkspacePath(cwd)) throw new Error('Worker not started')
      await workerManager.start(cwd)
    }
    await workerManager.setThinkingLevel(req.level)
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

  registerHandler('ipc:context.preview', async () => {
    if (!workerManager.isRunning) return { preview: null }
    try {
      return { preview: await workerManager.getSessionContextPreview() }
    } catch (e) {
      console.error('[IPC] context.preview failed:', e)
      return { preview: null }
    }
  })
}