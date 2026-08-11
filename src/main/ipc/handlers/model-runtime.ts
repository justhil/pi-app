import { app } from 'electron'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { isSandboxWorkspacePath } from '../../sandbox-workspaces'
import {
  readModelsConfigRaw,
  modelsCatalogFromConfig,
  fetchRemoteModelsCached,
  updateModelsConfigLight,
} from '../../pi-models-json'
import { getActiveSdkModule } from '../sdk-session'
import { getSessionContextPreviewFromDisk } from '../../session-context-preview'
import { getSessionLeafOverride } from '../../session-leaf-override'
import { authorizeTrustedSessionFile } from '../../trusted-workspace'
import { isWslRuntimeActive } from '../../wsl/runtime-config'
import { contextPreviewSchema } from '../schemas'
import type { ModelEntry } from '../../active-sdk-models'
import {
  listAvailableModelsWithSdk,
  listCatalogModelsWithSdk,
  resolveAvailableModels,
  resolveCatalogModels,
} from '../../active-sdk-models'

type ModelRow = {
  id: string
  name: string
  provider?: string
  contextWindow: number
  maxOutput: number
  available: boolean
  managedBy?: string
  auth?: { supported?: boolean; configured?: boolean }
}

function mapRegistry(
  models: readonly {
    id: string
    name?: string
    provider?: string
    contextWindow?: number
    maxOutput?: number
    maxTokens?: number
  }[],
): ModelRow[] {
  return models.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: m.provider,
    contextWindow: m.contextWindow || 0,
    maxOutput: m.maxOutput || m.maxTokens || 0,
    available: true,
  }))
}

/** 明确不是对话/文本生成的类型（网关可能把图片/视频/3D/音频模型也列在 /v1/models 里）。 */
const NON_CHAT_MODEL_TYPES = new Set([
  'image',
  'imagegen',
  'image-gen',
  'video',
  'videogen',
  'video-gen',
  'audio',
  'tts',
  'stt',
  'speech',
  'embedding',
  'rerank',
  'moderation',
  '3d',
  '3d-model',
  // 部分网关用 model_type: "model" 标记 3D 生成模型
  'model',
])

/**
 * 从 models.json 里配置了 baseUrl 的服务商拉取 /v1/models 目录（带 TTL 缓存），
 * 过滤掉明确的非对话类型，与本地/SDK 解析结果合并后展示给模型选择器。
 */
async function remoteCatalogModels(): Promise<ModelRow[]> {
  const { config } = readModelsConfigRaw()
  const rows: ModelRow[] = []
  await Promise.allSettled(
    Object.entries(config.providers || {}).map(async ([provider, p]) => {
      if (!p?.baseUrl) return
      const r = await fetchRemoteModelsCached(
        { baseUrl: p.baseUrl, apiKey: p.apiKey, authHeader: p.authHeader },
        { timeoutMs: 4_000 },
      )
      if (!r.ok) return
      for (const m of r.models) {
        if (m.modelType && NON_CHAT_MODEL_TYPES.has(m.modelType.toLowerCase())) continue
        rows.push({
          id: m.id,
          name: m.name || m.id,
          provider,
          contextWindow: 0,
          maxOutput: 0,
          available: true,
        })
      }
    }),
  )
  return rows
}

/**
 * 选中模型时若该 provider 已配置 baseUrl 但模型未声明，自动写入最小模型条目并重载，
 * 让网关拉取到的模型可以真正被会话使用。写入走轻量 update（无 SDK 校验/import，
 * 串行队列内基于磁盘最新状态追加），避免切换模型时卡顿。
 */
async function ensureModelDeclaredInConfig(provider: string, modelId: string, sessionFile?: string): Promise<void> {
  const r = await updateModelsConfigLight((current) => {
    const prov = current.providers?.[provider]
    if (!prov || !prov.baseUrl) return current
    if ((prov.models || []).some((m) => m?.id === modelId)) return current
    // 聊天模型默认声明支持扩展思考：否则 pi 会把该模型当作不支持 reasoning，
    // 将用户设置的 thinking level 静默钳制成 off（网关目录本身不声明此能力）。
    return {
      ...current,
      providers: {
        ...current.providers,
        [provider]: {
          ...prov,
          models: [
            ...(prov.models || []),
            { id: modelId, name: modelId, input: ['text'], reasoning: true },
          ],
        },
      },
    }
  })
  if (!r.ok) {
    console.warn('[IPC] model.set auto-register failed:', r.error)
    return
  }
  if (!r.changed) return
  try {
    // 目标会话可能绑定在后台 worker slot：刷新必须按 sessionFile 路由，
    // 否则 foreground 拿到新模型而目标 slot 仍是旧配置 → MODEL_NOT_FOUND
    await workerManager.reloadModels(sessionFile)
  } catch (e) {
    console.error('[IPC] model.set reloadModels failed:', e)
  }
}

/**
 * 合并本地/SDK 解析结果与远程网关目录：同一 provider+id 以本地为准（保留完整配置），
 * 远程补充未声明的模型。本地信息优先，远程不覆盖。
 */
function mergeModelRows(local: readonly ModelEntry[], remote: readonly ModelRow[]): ModelRow[] {
  const byKey = new Map<string, ModelRow>()
  for (const m of local) {
    const row: ModelRow = {
      id: m.id,
      name: m.name || m.id,
      provider: m.provider,
      contextWindow: m.contextWindow || 0,
      maxOutput: m.maxOutput || m.maxTokens || 0,
      available: m.available ?? true,
    }
    // settings scope 由 mapRegistry 提供鉴权/归属信息，合并远程模型时必须保留；
    // catalog 等 scope 不携带这些字段，保持原样（不输出多余键）。
    if (m.managedBy !== undefined) row.managedBy = m.managedBy
    if (m.auth !== undefined) row.auth = m.auth
    byKey.set(`${m.provider}:${m.id}`, row)
  }
  for (const m of remote) {
    const key = `${m.provider}:${m.id}`
    if (!byKey.has(key)) byKey.set(key, m)
  }
  return [...byKey.values()]
}

export function registerModelRuntimeHandlers(): void {
  registerHandler('ipc:model.list', async (req) => {
    const scope = req?.scope === 'available' ? 'available' : req?.scope === 'settings' ? 'settings' : 'catalog'
    const mapRegistry = (models: readonly ModelEntry[]) =>
      models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider || '',
        contextWindow: m.contextWindow || 0,
        maxOutput: m.maxOutput || m.maxTokens || 0,
        available: m.available ?? true,
        managedBy: m.managedBy,
        auth: m.auth,
      }))

    const catalogFromDisk = () => {
      const { config, parseError } = readModelsConfigRaw()
      if (parseError) return { models: [] as ModelEntry[] }
      return { models: modelsCatalogFromConfig(config) }
    }

    if (scope === 'settings' && workerManager.isRunning) {
      try {
        return {
          models: mapRegistry(
            (await workerManager.getModelSettingsSnapshot()).filter(
              (model): model is typeof model & { id: string } => typeof model.id === 'string',
            ),
          ),
        }
      } catch (error) {
        console.error('[IPC] model.list settings worker failed:', error)
      }
    }

    if (scope === 'catalog' || scope === 'settings') {
      const models = await resolveCatalogModels({
        sdk: async () => {
          const catalog = await listCatalogModelsWithSdk(await getActiveSdkModule(app.getPath('userData')))
          return scope === 'settings'
            ? mapRegistry(catalog)
            : catalog.map((model) => ({
                id: model.id,
                name: model.name || model.id,
                provider: model.provider || '',
                contextWindow: model.contextWindow || 0,
                maxOutput: model.maxOutput || model.maxTokens || 0,
                available: true,
              }))
        },
        catalog: () => catalogFromDisk().models,
        onSdkError: (error) => console.error('[IPC] model.list catalog failed:', error),
      })
      return { models: mergeModelRows(models, await remoteCatalogModels()) }
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
    return { models: mergeModelRows(models, await remoteCatalogModels()) }
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
    // 网关拉取到的模型可能尚未写入 models.json：先自动注册再设置，避免 MODEL_NOT_FOUND
    await ensureModelDeclaredInConfig(provider, modelId, sessionFile)
    if (!workerManager.isRunning && !sessionFile) {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (!cwd || isSandboxWorkspacePath(cwd)) throw new Error('Worker not started')
      await workerManager.start(cwd)
    }
    const actualModel = await workerManager.setModel(provider, modelId, sessionFile)
    return { modelId: actualModel }
  })

  registerHandler('ipc:model.cycle', async () => ({
    modelId: '',
    thinkingLevel: 'medium',
  }))

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
