import type { PiModelDefinition, PiModelsApi, PiModelsConfig, PiProviderConfig } from './pi-models-json'

const API_SET = new Set<PiModelsApi>([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
])

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function trimStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s || undefined
}

function posInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

function normalizeInput(v: unknown): ('text' | 'image')[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: ('text' | 'image')[] = []
  for (const item of v) {
    if (item === 'text' || item === 'image') {
      if (!out.includes(item)) out.push(item)
    }
  }
  return out.length ? out : undefined
}

function normalizeModel(raw: unknown, warnings: string[], ctx: string): PiModelDefinition | null {
  const o = asRecord(raw)
  if (!o) {
    warnings.push(`${ctx}: 模型项不是对象，已跳过`)
    return null
  }
  const id = trimStr(o.id)
  if (!id) {
    warnings.push(`${ctx}: 缺少 id，已跳过`)
    return null
  }
  const api = trimStr(o.api) as PiModelsApi | undefined
  if (api && !API_SET.has(api)) {
    warnings.push(`${ctx}「${id}」: 未知 api「${api}」，已清除`)
  }
  const input = normalizeInput(o.input)
  return {
    id,
    name: trimStr(o.name),
    api: api && API_SET.has(api) ? api : undefined,
    reasoning: o.reasoning === true ? true : undefined,
    input: input ?? (o.input != null ? ['text'] : undefined),
    contextWindow: posInt(o.contextWindow),
    maxTokens: posInt(o.maxTokens),
  }
}

function normalizeProvider(raw: unknown, warnings: string[], key: string): PiProviderConfig {
  const o = asRecord(raw)
  if (!o) {
    warnings.push(`供应商「${key}」不是对象，已置为空配置`)
    return { models: [] }
  }
  const api = trimStr(o.api) as PiModelsApi | undefined
  if (api && !API_SET.has(api)) {
    warnings.push(`供应商「${key}」: 未知 api「${api}」，已清除`)
  }
  const modelsRaw = o.models
  const models: PiModelDefinition[] = []
  const seen = new Set<string>()
  if (Array.isArray(modelsRaw)) {
    modelsRaw.forEach((m, i) => {
      const norm = normalizeModel(m, warnings, `providers.${key}.models[${i}]`)
      if (!norm) return
      if (seen.has(norm.id)) {
        warnings.push(`供应商「${key}」: 重复模型 id「${norm.id}」，已去重`)
        return
      }
      seen.add(norm.id)
      models.push(norm)
    })
  } else if (modelsRaw != null) {
    warnings.push(`供应商「${key}」: models 应为数组，已忽略`)
  }

  let modelOverrides: Record<string, unknown> | undefined
  const mo = o.modelOverrides
  if (mo != null) {
    const rec = asRecord(mo)
    if (rec) modelOverrides = rec
    else warnings.push(`供应商「${key}」: modelOverrides 应为对象，已忽略`)
  }

  const headersRaw = o.headers
  let headers: Record<string, string> | undefined
  if (headersRaw != null) {
    const rec = asRecord(headersRaw)
    if (rec) {
      headers = {}
      for (const [hk, hv] of Object.entries(rec)) {
        if (typeof hv === 'string') headers[hk] = hv
      }
    }
  }

  return {
    name: trimStr(o.name),
    baseUrl: trimStr(o.baseUrl),
    api: api && API_SET.has(api) ? api : undefined,
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : undefined,
    authHeader: o.authHeader === false ? false : o.authHeader === true ? true : undefined,
    headers,
    models: models.length ? models : undefined,
    modelOverrides,
  }
}

/** 将磁盘 JSON 解析结果规整为 pi 可接受的结构，并收集非致命告警 */
export function normalizeModelsConfig(raw: unknown): { config: PiModelsConfig; warnings: string[] } {
  const warnings: string[] = []
  const root = asRecord(raw)
  if (!root) {
    warnings.push('根对象无效，已使用空 providers')
    return { config: { providers: {} }, warnings }
  }
  const provRaw = root.providers
  const providers: Record<string, PiProviderConfig> = {}
  if (provRaw == null) {
    warnings.push('缺少 providers，已使用空对象')
    return { config: { providers: {} }, warnings }
  }
  const provRec = asRecord(provRaw)
  if (!provRec) {
    warnings.push('providers 不是对象，已使用空对象')
    return { config: { providers: {} }, warnings }
  }
  for (const [key, val] of Object.entries(provRec)) {
    const k = key.trim()
    if (!k) {
      warnings.push('发现空供应商键名，已跳过')
      continue
    }
    providers[k] = normalizeProvider(val, warnings, k)
  }
  return { config: { providers }, warnings }
}