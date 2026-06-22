import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveActiveSdk } from './sdk-loader'

export type PiModelsApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'

export type PiModelDefinition = {
  id: string
  name?: string
  api?: string
  reasoning?: boolean
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
}

export type PiProviderConfig = {
  name?: string
  baseUrl?: string
  api?: PiModelsApi
  apiKey?: string
  authHeader?: boolean
  headers?: Record<string, string>
  models?: PiModelDefinition[]
  modelOverrides?: Record<string, unknown>
}

export type PiModelsConfig = {
  providers: Record<string, PiProviderConfig>
}

export function getModelsJsonPath(): string {
  return join(homedir(), '.pi', 'agent', 'models.json')
}

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ''))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ''))
}

export function readModelsConfigRaw(): { path: string; config: PiModelsConfig; raw?: string; parseError?: string } {
  const path = getModelsJsonPath()
  if (!existsSync(path)) {
    return { path, config: { providers: {} } }
  }
  const raw = readFileSync(path, 'utf-8')
  try {
    const parsed = JSON.parse(stripJsonComments(raw)) as PiModelsConfig
    if (!parsed?.providers || typeof parsed.providers !== 'object') {
      return { path, config: { providers: {} }, raw, parseError: '根对象需包含 providers' }
    }
    return { path, config: parsed, raw }
  } catch (e: any) {
    return { path, config: { providers: {} }, raw, parseError: e?.message || 'JSON 解析失败' }
  }
}

async function loadPiSdk(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const active = resolveActiveSdk(app.getPath('userData'))
  if (active.kind === 'builtin') return import(active.entryPath)
  return import(pathToFileURL(active.entryPath).href)
}

async function validateWithPiSdk(config: PiModelsConfig): Promise<string | undefined> {
  try {
    const sdk = await loadPiSdk()
    const agentDir = sdk.getAgentDir?.() ?? join(homedir(), '.pi', 'agent')
    const tmpPath = join(agentDir, '.models-json-validate.tmp')
    mkdirSync(dirname(tmpPath), { recursive: true })
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
    const { ModelRegistry, AuthStorage } = sdk
    const registry = ModelRegistry.create(AuthStorage.create(), tmpPath)
    const err = registry.getModelsJsonError?.()
    return err ? String(err) : undefined
  } catch (e: any) {
    return e?.message || '校验失败'
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

export async function readModelsConfig(): Promise<{
  path: string
  config: PiModelsConfig
  schemaError?: string
  parseError?: string
}> {
  const base = readModelsConfigRaw()
  if (base.parseError) return base
  const schemaError = await validateWithPiSdk(base.config)
  return { ...base, schemaError }
}

export async function writeModelsConfig(config: PiModelsConfig): Promise<{ ok: boolean; error?: string; path: string }> {
  const path = getModelsJsonPath()
  const schemaError = await validateWithPiSdk(config)
  if (schemaError) return { ok: false, error: schemaError, path }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  return { ok: true, path }
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
  } catch (e: any) {
    return { ok: false, error: e?.message || '请求失败' }
  }
}