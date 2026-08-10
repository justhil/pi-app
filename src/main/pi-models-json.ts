import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
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

export async function fetchRemoteModelIds(input: {
  baseUrl: string
  apiKey?: string
  authHeader?: boolean
}): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
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
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` }
    }
    const data = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string; name?: string }[] }
    const fromData = (data.data || []).map((m) => m.id).filter(Boolean) as string[]
    const fromModels = (data.models || []).map((m) => m.id || m.name).filter(Boolean) as string[]
    const ids = [...new Set([...fromData, ...fromModels])].sort((a, b) => a.localeCompare(b))
    if (ids.length === 0) return { ok: false, error: '响应中未找到模型列表（需 OpenAI 兼容 /v1/models）' }
    return { ok: true, ids }
  } catch (e: unknown) {
    return { ok: false, error: (e as { message?: string })?.message || '请求失败' }
  }
}