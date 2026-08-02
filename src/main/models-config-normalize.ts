import type { PiModelDefinition, PiModelsConfig, PiProviderConfig } from './pi-models-json'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeModel(raw: unknown, warnings: string[], context: string): PiModelDefinition | null {
  const model = asRecord(raw)
  if (!model) {
    warnings.push(`${context}: 模型项不是对象`)
    return cloneRecord(raw) as PiModelDefinition
  }
  if (typeof model.id !== 'string' || !model.id.trim()) {
    warnings.push(`${context}: 缺少 id`)
  }
  return cloneRecord(model) as PiModelDefinition
}

function normalizeProvider(raw: unknown, warnings: string[], key: string): PiProviderConfig | null {
  const provider = asRecord(raw)
  if (!provider) {
    warnings.push(`供应商「${key}」不是对象`)
    return cloneRecord(raw) as PiProviderConfig
  }
  if (provider.models !== undefined && !Array.isArray(provider.models)) {
    warnings.push(`供应商「${key}」: models 应为数组`)
    return cloneRecord(provider) as PiProviderConfig
  }

  const normalized = cloneRecord(provider) as PiProviderConfig
  if (Array.isArray(provider.models)) {
    normalized.models = provider.models
      .map((model, index) => normalizeModel(model, warnings, `providers.${key}.models[${index}]`))
      .filter((model): model is PiModelDefinition => model !== null)
  }
  return normalized
}

/** 保留上游文档原值；结构告警只用于 UI，合法性由 active SDK 决定。 */
export function normalizeModelsConfig(raw: unknown): { config: PiModelsConfig; warnings: string[] } {
  const warnings: string[] = []
  const root = asRecord(raw)
  if (!root) {
    return { config: { providers: {} }, warnings: ['根对象无效'] }
  }
  const providersSource = asRecord(root.providers)
  if (!providersSource) {
    return {
      config: { ...cloneRecord(root), providers: {} } as PiModelsConfig,
      warnings: [root.providers === undefined ? '缺少 providers' : 'providers 不是对象'],
    }
  }

  const providers: Record<string, PiProviderConfig> = {}
  for (const [key, value] of Object.entries(providersSource)) {
    const provider = normalizeProvider(value, warnings, key)
    if (provider) providers[key] = provider
  }
  return { config: { ...cloneRecord(root), providers } as PiModelsConfig, warnings }
}
