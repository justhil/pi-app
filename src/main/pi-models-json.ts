import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { app } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveActiveSdk } from './sdk-loader'
import { normalizeModelsConfig } from './models-config-normalize'
import { validateModelsConfigWithSdk } from './active-sdk-models'
import { resolveActiveAgentDir } from './agent-dir'

export type PiModelDefinition = {
  id: string
  name?: string
  api?: string
  reasoning?: boolean
  input?: unknown
  contextWindow?: number
  maxTokens?: number
  thinkingLevelMap?: Record<string, string | null>
  baseUrl?: string
  headers?: Record<string, unknown>
  cost?: Record<string, unknown>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

export type PiProviderConfig = {
  name?: string
  baseUrl?: string
  api?: string
  apiKey?: string
  authHeader?: boolean
  headers?: Record<string, unknown>
  models?: PiModelDefinition[]
  modelOverrides?: Record<string, unknown>
  oauth?: string
  compat?: Record<string, unknown>
  [key: string]: unknown
}

export type PiModelsConfig = {
  providers: Record<string, PiProviderConfig>
  [key: string]: unknown
}

export function getModelsJsonPath(agentDir = resolveActiveAgentDir()): string {
  return join(agentDir, 'models.json')
}

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ''))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ''))
}

export function readModelsConfigRaw(modelsPath = getModelsJsonPath()): {
  path: string
  config: PiModelsConfig
  raw?: string
  parseError?: string
  warnings?: string[]
} {
  const path = modelsPath
  if (!existsSync(path)) {
    return { path, config: { providers: {} } }
  }
  const raw = readFileSync(path, 'utf-8')
  try {
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown
    const { config, warnings } = normalizeModelsConfig(parsed)
    return { path, config, raw, warnings: warnings.length ? warnings : undefined }
  } catch (e: unknown) {
    return { path, config: { providers: {} }, raw, parseError: (e as { message?: string })?.message || 'JSON 解析失败' }
  }
}

async function loadPiSdk(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const active = resolveActiveSdk(app.getPath('userData'))
  if (active.kind === 'builtin') return import(active.entryPath)
  return import(pathToFileURL(active.entryPath).href)
}

async function validateWithPiSdk(sdk: unknown, agentDir: string, config: unknown): Promise<string | undefined> {
  try {
    return await validateModelsConfigWithSdk(sdk, agentDir, config)
  } catch (e: unknown) {
    return (e as { message?: string })?.message || '校验失败'
  }
}

export type ModelsJsonCatalogEntry = {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  available: boolean
}

/** 从 ~/.pi/agent/models.json 展开全部 provider/model（与项目无关） */
export function modelsCatalogFromConfig(config: PiModelsConfig): ModelsJsonCatalogEntry[] {
  const out: ModelsJsonCatalogEntry[] = []
  for (const [providerKey, prov] of Object.entries(config.providers || {})) {
    for (const model of prov.models || []) {
      if (!model?.id) continue
      out.push({
        id: model.id,
        name: model.name || model.id,
        provider: providerKey,
        contextWindow: model.contextWindow ?? 0,
        maxOutput: model.maxTokens ?? 0,
        available: true,
      })
    }
  }
  return out
}

export async function readModelsConfigWithSdk(sdk: unknown, agentDir: string): Promise<{
  path: string
  config: PiModelsConfig
  schemaError?: string
  parseError?: string
  warnings?: string[]
}> {
  const base = readModelsConfigRaw(getModelsJsonPath(agentDir))
  if (base.parseError) return base
  const schemaError = await validateWithPiSdk(sdk, agentDir, base.config)
  return { ...base, schemaError }
}

export async function readModelsConfig(): Promise<Awaited<ReturnType<typeof readModelsConfigWithSdk>>> {
  const sdk = await loadPiSdk()
  const agentDir = resolveActiveAgentDir()
  return readModelsConfigWithSdk(sdk, agentDir)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeDraftModel(model: PiModelDefinition): PiModelDefinition {
  const normalized = cloneJson(model)
  if (Array.isArray(normalized.input)) normalized.input = [...normalized.input]
  if (normalized.thinkingLevelMap) normalized.thinkingLevelMap = { ...normalized.thinkingLevelMap }
  return normalized
}

function normalizeDraftProvider(provider: PiProviderConfig): PiProviderConfig {
  const normalized = cloneJson(provider)
  if (normalized.headers) normalized.headers = { ...normalized.headers }
  if (normalized.compat) normalized.compat = { ...normalized.compat }
  if (normalized.modelOverrides) normalized.modelOverrides = cloneJson(normalized.modelOverrides)
  if (normalized.models) normalized.models = normalized.models.map(normalizeDraftModel)
  return normalized
}

function normalizeDraftConfig(config: PiModelsConfig): PiModelsConfig {
  return {
    ...cloneJson(config),
    providers: Object.fromEntries(
      Object.entries(config.providers || {}).map(([key, provider]) => [key, normalizeDraftProvider(provider)]),
    ),
  }
}

function mergeModelWithRetained(
  draft: PiModelDefinition,
  retainedById: Map<string, PiModelDefinition>,
): PiModelDefinition {
  const retained = retainedById.get(draft.id.trim())
  return retained ? { ...retained, ...draft } : draft
}

function mergeProviderWithRetained(draft: PiProviderConfig, retained: PiProviderConfig | undefined): PiProviderConfig {
  const merged = retained ? { ...retained, ...draft } : draft
  if (!draft.models || !retained?.models) return merged
  const retainedById = new Map(retained.models.map((model) => [model.id, model]))
  return { ...merged, models: draft.models.map((model) => mergeModelWithRetained(model, retainedById)) }
}

function readRetainedModelsConfig(modelsPath: string): Record<string, unknown> | null {
  if (!existsSync(modelsPath)) return null
  return asRecord(JSON.parse(stripJsonComments(readFileSync(modelsPath, 'utf-8'))))
}

export function mergeModelsConfigWithRetained(config: PiModelsConfig, retainedRoot: Record<string, unknown> | null): unknown {
  const draft = normalizeDraftConfig(config)
  const retainedProviders = asRecord(retainedRoot?.providers)
  if (!retainedRoot || !retainedProviders) return draft
  return {
    ...retainedRoot,
    ...draft,
    providers: Object.fromEntries(
      Object.entries(draft.providers).map(([key, provider]) => [
        key,
        mergeProviderWithRetained(provider, asRecord(retainedProviders[key]) as PiProviderConfig | null ?? undefined),
      ]),
    ),
  }
}

function redactConfigSecrets(message: string, config: PiModelsConfig): string {
  let redacted = message
  for (const provider of Object.values(config.providers)) {
    if (provider.apiKey && !provider.apiKey.startsWith('$') && !provider.apiKey.startsWith('!')) {
      redacted = redacted.replaceAll(provider.apiKey, '[REDACTED]')
    }
  }
  return redacted
}

export async function writeModelsConfigWithSdk(
  config: PiModelsConfig,
  sdk: unknown,
  agentDir: string,
): Promise<{ ok: boolean; error?: string; path: string }> {
  const path = getModelsJsonPath(agentDir)
  let retainedRoot: Record<string, unknown> | null
  try {
    retainedRoot = readRetainedModelsConfig(path)
  } catch (error: unknown) {
    return {
      ok: false,
      error: `原 models.json 无法解析，未写入: ${(error as { message?: string })?.message || 'JSON 解析失败'}`,
      path,
    }
  }
  const merged = mergeModelsConfigWithRetained(config, retainedRoot)
  const { config: normalized, warnings } = normalizeModelsConfig(merged)
  if (warnings.length) {
    console.warn('[models.json] structure warnings:', warnings.join('; '))
  }
  const output = asRecord(merged) ?? normalized
  const schemaError = await validateWithPiSdk(sdk, agentDir, output)
  if (schemaError) return { ok: false, error: redactConfigSecrets(schemaError, config), path }
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmpPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8')
    renameSync(tmpPath, path)
  } finally {
    rmSync(tmpPath, { force: true })
  }
  return { ok: true, path }
}

export async function writeModelsConfig(config: PiModelsConfig): Promise<{ ok: boolean; error?: string; path: string }> {
  const sdk = await loadPiSdk()
  const agentDir = resolveActiveAgentDir()
  return writeModelsConfigWithSdk(config, sdk, agentDir)
}

let lightWriteChain: Promise<unknown> = Promise.resolve()

/**
 * 轻量更新 models.json：在串行写入点内读取磁盘最新配置，应用 apply 变更后
 * 原子写盘（异步 fs），不做 SDK 校验。用于低风险的自动注册（如 model.set 兜底
 * 追加网关拉取到的模型），避免触发全局 SDK 动态 import（冷启动实测 ~1s）与
 * ModelRuntime 校验开销；串行队列 + 基于磁盘最新状态的变更保证并发追加不丢条目。
 */
export function updateModelsConfigLight(
  apply: (current: PiModelsConfig) => PiModelsConfig,
  agentDir?: string,
): Promise<
  | { ok: true; path: string; changed: boolean }
  | { ok: false; error: string; path: string }
> {
  const path = getModelsJsonPath(agentDir)
  const run = async () => {
    try {
      const current = readModelsConfigRaw(path).config
      const next = apply(current)
      if (next === current) return { ok: true as const, path, changed: false }
      let retainedRoot: Record<string, unknown> | null
      try {
        retainedRoot = readRetainedModelsConfig(path)
      } catch (error: unknown) {
        return {
          ok: false as const,
          error: `原 models.json 无法解析，未写入: ${(error as { message?: string })?.message || 'JSON 解析失败'}`,
          path,
        }
      }
      const merged = mergeModelsConfigWithRetained(next, retainedRoot)
      const { config: normalized, warnings } = normalizeModelsConfig(merged)
      if (warnings.length) {
        console.warn('[models.json] structure warnings:', warnings.join('; '))
      }
      const output = asRecord(merged) ?? normalized
      await mkdir(dirname(path), { recursive: true })
      const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
      try {
        await writeFile(tmpPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8')
        await rename(tmpPath, path)
      } finally {
        await rm(tmpPath, { force: true }).catch(() => undefined)
      }
      return { ok: true as const, path, changed: true }
    } catch (error: unknown) {
      return {
        ok: false as const,
        error: (error as { message?: string })?.message || '写入失败',
        path,
      }
    }
  }
  const result = lightWriteChain.then(run, run)
  lightWriteChain = result.catch(() => undefined)
  return result
}

function resolveApiKeyForFetch(apiKey?: string): string | undefined {
  if (!apiKey) return undefined
  const m = apiKey.match(/^\$([A-Z0-9_]+)$|^\$\{([A-Z0-9_]+)\}$/)
  if (m) {
    const name = m[1] || m[2]
    return process.env[name]
  }
  if (apiKey.startsWith('!')) return undefined
  return apiKey
}

function modelsListUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/models`
  return `${trimmed}/v1/models`
}

export type RemoteModelEntry = {
  id: string
  name?: string
  /** OpenAI 兼容响应中的 model_type / type（网关可能有，如 chat / image / video）。 */
  modelType?: string
}

/** 从 OpenAI 兼容 /v1/models 拉取完整模型目录（保留类型信息）。 */
export async function fetchRemoteModels(
  input: {
    baseUrl: string
    apiKey?: string
    authHeader?: boolean
  },
  options?: { timeoutMs?: number },
): Promise<{ ok: true; models: RemoteModelEntry[] } | { ok: false; error: string }> {
  const baseUrl = input.baseUrl?.trim()
  if (!baseUrl) return { ok: false, error: '缺少 baseUrl' }
  const key = resolveApiKeyForFetch(input.apiKey)
  const url = modelsListUrl(baseUrl)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (key) {
    if (input.authHeader !== false) headers.Authorization = `Bearer ${key}`
    else headers['x-api-key'] = key
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(options?.timeoutMs ?? 25_000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` }
    }
    const raw = (await res.json()) as {
      data?: { id?: string; name?: string; model_type?: string; type?: string }[]
      models?: { id?: string; name?: string; model_type?: string; type?: string }[]
    }
    const collect = (rows: typeof raw.data | undefined): RemoteModelEntry[] =>
      (rows || []).flatMap((m) => {
        const id = m.id || m.name
        if (!id) return []
        return [{ id, name: m.name || id, modelType: m.model_type || m.type }]
      })
    const models = [...new Map([...collect(raw.data), ...collect(raw.models)].map((m) => [m.id, m])).values()].sort(
      (a, b) => a.id.localeCompare(b.id),
    )
    if (models.length === 0) return { ok: false, error: '响应中未找到模型列表（需 OpenAI 兼容 /v1/models）' }
    return { ok: true, models }
  } catch (e: unknown) {
    return { ok: false, error: (e as { message?: string })?.message || '请求失败' }
  }
}

export async function fetchRemoteModelIds(input: {
  baseUrl: string
  apiKey?: string
  authHeader?: boolean
}): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const result = await fetchRemoteModels(input)
  if (!result.ok) return result
  return { ok: true, ids: result.models.map((m) => m.id) }
}

const remoteCatalogCache = new Map<string, { at: number; models: RemoteModelEntry[] }>()
/** 远程模型目录缓存有效期（60 秒）：模型选择器每次打开都会合并远程目录，
 *  缓存过期时自动拉取最新列表，避免网关上新模型后长时间显示不全。 */
export const REMOTE_MODEL_CATALOG_TTL_MS = 60_000

/** 带 TTL 缓存的远程模型目录拉取，按 baseUrl 缓存。 */
export async function fetchRemoteModelsCached(
  input: {
    baseUrl: string
    apiKey?: string
    authHeader?: boolean
  },
  options?: { timeoutMs?: number },
): Promise<{ ok: true; models: RemoteModelEntry[] } | { ok: false; error: string }> {
  const baseUrl = input.baseUrl?.trim()
  if (!baseUrl) return { ok: false, error: '缺少 baseUrl' }
  const hit = remoteCatalogCache.get(baseUrl)
  if (hit && Date.now() - hit.at < REMOTE_MODEL_CATALOG_TTL_MS) return { ok: true, models: hit.models }
  const result = await fetchRemoteModels({ baseUrl, apiKey: input.apiKey, authHeader: input.authHeader }, options)
  if (result.ok) remoteCatalogCache.set(baseUrl, { at: Date.now(), models: result.models })
  return result
}

/** 清空远程模型目录缓存（测试用）。 */
export function clearRemoteModelCatalogCache(): void {
  remoteCatalogCache.clear()
}
