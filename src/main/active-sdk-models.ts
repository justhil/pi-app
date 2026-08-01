import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'

export type ModelEntry = {
  id: string
  name?: string
  provider?: string
  contextWindow?: number
  maxOutput?: number
  maxTokens?: number
}

type LegacyRegistry = {
  getModelsJsonError?: () => unknown
  getError?: () => unknown
  getAll?: () => readonly ModelEntry[] | Promise<readonly ModelEntry[]>
  getAvailable?: () => readonly ModelEntry[] | Promise<readonly ModelEntry[]>
}

type ModernRuntime = {
  getError?: () => unknown
  getModels?: () => readonly ModelEntry[] | Promise<readonly ModelEntry[]>
  getAvailable?: () => Promise<readonly ModelEntry[]>
  getAvailableSnapshot?: () => readonly ModelEntry[]
}

type ActiveModelSdk = {
  getAgentDir?: () => string
  AuthStorage?: { create?: () => unknown }
  ModelRegistry?: { create?: (auth: unknown, modelsPath?: string) => LegacyRegistry }
  ModelRuntime?: {
    create?: (options?: {
      modelsPath?: string | null
      allowModelNetwork?: boolean
    }) => Promise<ModernRuntime>
  }
}

export const UNSUPPORTED_MODEL_SDK_ERROR = '当前 Pi SDK 不支持模型配置校验，请切换或升级 SDK'

function hasModernRuntime(sdk: ActiveModelSdk): boolean {
  return typeof sdk.ModelRuntime?.create === 'function'
}

function hasLegacyRegistry(sdk: ActiveModelSdk): boolean {
  return (
    typeof sdk.AuthStorage?.create === 'function' &&
    typeof sdk.ModelRegistry?.create === 'function'
  )
}

export async function validateModelsConfigWithSdk(
  sdk: unknown,
  agentDir: string,
  config: unknown,
): Promise<string | undefined> {
  const modelsPath = join(
    agentDir,
    `.models-json-validate-${process.pid}-${randomUUID()}.tmp`,
  )
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(modelsPath, JSON.stringify(config, null, 2), 'utf8')
  try {
    return await validateModelsPathWithSdk(sdk, modelsPath)
  } finally {
    rmSync(modelsPath, { force: true })
  }
}

export async function validateModelsPathWithSdk(
  sdk: unknown,
  modelsPath: string,
): Promise<string | undefined> {
  const module = sdk as ActiveModelSdk
  if (hasModernRuntime(module)) {
    const runtime = await module.ModelRuntime!.create!({
      modelsPath,
      allowModelNetwork: false,
    })
    if (typeof runtime.getError !== 'function') return UNSUPPORTED_MODEL_SDK_ERROR
    const error = runtime.getError()
    return error ? String(error) : undefined
  }

  if (hasLegacyRegistry(module)) {
    const auth = module.AuthStorage!.create!()
    const registry = module.ModelRegistry!.create!(auth, modelsPath)
    if (typeof registry.getModelsJsonError === 'function') {
      const error = registry.getModelsJsonError()
      return error ? String(error) : undefined
    }
    if (typeof registry.getError === 'function') {
      const error = registry.getError()
      return error ? String(error) : undefined
    }
    return UNSUPPORTED_MODEL_SDK_ERROR
  }

  return UNSUPPORTED_MODEL_SDK_ERROR
}

export async function resolveCatalogModels(input: {
  sdk: () => Promise<readonly ModelEntry[]>
  catalog: () => readonly ModelEntry[]
  onSdkError?: (error: unknown) => void
}): Promise<readonly ModelEntry[]> {
  try {
    const models = await input.sdk()
    if (models.length > 0) return models
  } catch (error) {
    input.onSdkError?.(error)
  }
  return input.catalog()
}

export async function resolveAvailableModels(input: {
  worker?: () => Promise<readonly ModelEntry[]>
  sdk: () => Promise<readonly ModelEntry[]>
  onWorkerError?: (error: unknown) => void
  onSdkError?: (error: unknown) => void
}): Promise<readonly ModelEntry[]> {
  if (input.worker) {
    try {
      const models = await input.worker()
      if (models.length > 0) return models
    } catch (error) {
      input.onWorkerError?.(error)
    }
  }
  try {
    const models = await input.sdk()
    if (models.length > 0) return models
  } catch (error) {
    input.onSdkError?.(error)
  }
  return []
}

export async function listCatalogModelsWithSdk(
  sdk: unknown,
): Promise<readonly ModelEntry[]> {
  const module = sdk as ActiveModelSdk
  if (hasModernRuntime(module)) {
    const agentDir = module.getAgentDir?.()
    const runtime = await module.ModelRuntime!.create!({
      ...(agentDir ? { modelsPath: join(agentDir, 'models.json') } : {}),
      allowModelNetwork: false,
    })
    if (runtime.getModels) return runtime.getModels()
  }

  if (hasLegacyRegistry(module)) {
    const auth = module.AuthStorage!.create!()
    const registry = module.ModelRegistry!.create!(auth)
    return (await registry.getAll?.()) ?? []
  }

  return []
}

export async function listAvailableModelsWithSdk(
  sdk: unknown,
): Promise<readonly ModelEntry[]> {
  const module = sdk as ActiveModelSdk
  if (hasModernRuntime(module)) {
    const runtime = await module.ModelRuntime!.create!({ allowModelNetwork: true })
    if (runtime.getAvailable) return runtime.getAvailable()
    return runtime.getAvailableSnapshot?.() ?? []
  }

  if (hasLegacyRegistry(module)) {
    const auth = module.AuthStorage!.create!()
    const registry = module.ModelRegistry!.create!(auth)
    return (await registry.getAvailable?.()) ?? []
  }

  return []
}
