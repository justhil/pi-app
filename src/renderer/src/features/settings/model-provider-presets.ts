import type { PiModelsProviderConfig } from '@shared/ipc-contract'
import type { UpstreamCatalogSnapshot } from '@shared/models-dev-catalog'
import type { TFunction } from 'i18next'

export type ProviderPresetId =
  | 'custom-openai'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'qwen'
  | 'minimax'
  | 'openrouter'
  | 'siliconflow'
  | 'groq'
  | 'ollama'

export type ProviderPresetCategory = 'official' | 'relay' | 'local'

export type ProviderPreset = {
  id: ProviderPresetId
  category: ProviderPresetCategory
  label: string
  labelKey?: string
  tagline: string
  taglineKey?: string
  aliases?: string[]
  /** Default isolated provider key (avoids built-in SDK provider collision so only user-added models appear). */
  defaultKey: string
  /** Built-in SDK provider key if this vendor also exists natively in Pi SDK. */
  sdkBuiltInKey?: string
  apiKeyPlaceholder?: string
  baseUrlPlaceholder?: string
  accentClass: string
  config: PiModelsProviderConfig
}

/** Known built-in Pi SDK provider IDs whose built-in catalog models merge in when reused in models.json. */
export const KNOWN_SDK_BUILTIN_PROVIDER_IDS = new Set([
  'amazon-bedrock',
  'ant-ling',
  'anthropic',
  'azure',
  'baseten',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'deepseek',
  'fireworks',
  'github-copilot',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'meta',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'qwen-token-plan-individual',
  'radius',
  'together',
  'vercel-ai-gateway',
  'xai',
  'xiaomi',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'zai',
  'zai-coding-cn',
])

export function isBuiltInSdkProviderId(
  providerId: string,
  runtimeSdkProviderIds?: Iterable<string>,
): boolean {
  const normalized = providerId.trim().toLowerCase()
  if (!normalized) return false
  if (KNOWN_SDK_BUILTIN_PROVIDER_IDS.has(normalized)) return true
  if (runtimeSdkProviderIds) {
    for (const id of runtimeSdkProviderIds) {
      if (id.toLowerCase() === normalized) return true
    }
  }
  return false
}

export function validateProviderKey(
  raw: string,
  existing: Record<string, unknown>,
  currentId?: string,
): { ok: true; key: string } | { ok: false; reason: 'empty' | 'invalid-chars' | 'duplicate' } {
  const key = raw.trim()
  if (!key) return { ok: false, reason: 'empty' }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(key)) {
    return { ok: false, reason: 'invalid-chars' }
  }
  if (key !== currentId && Object.prototype.hasOwnProperty.call(existing, key)) {
    return { ok: false, reason: 'duplicate' }
  }
  return { ok: true, key }
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'custom-openai',
    category: 'relay',
    label: 'Custom Channel',
    labelKey: 'settings:models.presetCustomRelay',
    tagline: 'Custom baseUrl & API protocol',
    taglineKey: 'settings:models.presetTaglines.customBaseUrl',
    aliases: ['中转', '自定义', '代理', '渠道', 'proxy', 'newapi', 'oneapi', 'relay', 'cpa'],
    defaultKey: 'custom',
    baseUrlPlaceholder: 'https://your-relay.example.com/v1',
    apiKeyPlaceholder: 'sk-... or $MY_API_KEY',
    accentClass: 'bg-slate-600',
    config: {
      api: 'openai-responses',
    },
  },
  {
    id: 'openai',
    category: 'official',
    label: 'OpenAI',
    tagline: 'Official or OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openai',
    aliases: ['gpt', 'chatgpt', 'o3', 'codex'],
    defaultKey: 'openai-custom',
    sdkBuiltInKey: 'openai',
    apiKeyPlaceholder: '$OPENAI_API_KEY',
    accentClass: 'bg-emerald-600',
    config: {
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
    },
  },
  {
    id: 'anthropic',
    category: 'official',
    label: 'Anthropic',
    tagline: 'Claude Messages API',
    taglineKey: 'settings:models.presetTaglines.anthropic',
    aliases: ['claude', 'sonnet', 'opus'],
    defaultKey: 'anthropic-custom',
    sdkBuiltInKey: 'anthropic',
    apiKeyPlaceholder: '$ANTHROPIC_API_KEY',
    accentClass: 'bg-orange-600',
    config: {
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
    },
  },
  {
    id: 'gemini',
    category: 'official',
    label: 'Google Gemini',
    tagline: 'Gemini API',
    taglineKey: 'settings:models.presetTaglines.gemini',
    aliases: ['google', 'gemini'],
    defaultKey: 'gemini-custom',
    sdkBuiltInKey: 'google',
    apiKeyPlaceholder: '$GEMINI_API_KEY',
    accentClass: 'bg-blue-600',
    config: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      api: 'google-generative-ai',
    },
  },
  {
    id: 'deepseek',
    category: 'official',
    label: 'DeepSeek',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['深度求索', 'ds', 'r1', 'v3'],
    defaultKey: 'deepseek-custom',
    sdkBuiltInKey: 'deepseek',
    apiKeyPlaceholder: '$DEEPSEEK_API_KEY',
    accentClass: 'bg-cyan-600',
    config: {
      baseUrl: 'https://api.deepseek.com/v1',
      api: 'openai-completions',
    },
  },
  {
    id: 'moonshot',
    category: 'official',
    label: 'Moonshot / Kimi',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['kimi', '月之暗面'],
    defaultKey: 'moonshot-custom',
    sdkBuiltInKey: 'moonshot',
    apiKeyPlaceholder: '$MOONSHOT_API_KEY',
    accentClass: 'bg-amber-600',
    config: {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
    },
  },
  {
    id: 'zhipu',
    category: 'official',
    label: 'Zhipu GLM',
    labelKey: 'settings:models.presetZhipu',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['智谱', 'glm', 'bigmodel'],
    defaultKey: 'zhipu-custom',
    sdkBuiltInKey: 'zhipu',
    apiKeyPlaceholder: '$ZHIPU_API_KEY',
    accentClass: 'bg-indigo-600',
    config: {
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      api: 'openai-completions',
    },
  },
  {
    id: 'qwen',
    category: 'official',
    label: 'Qwen / DashScope',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['通义千问', '阿里云', '百炼', 'dashscope', 'alibaba'],
    defaultKey: 'qwen-custom',
    sdkBuiltInKey: 'qwen',
    apiKeyPlaceholder: '$DASHSCOPE_API_KEY',
    accentClass: 'bg-sky-600',
    config: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
    },
  },
  {
    id: 'minimax',
    category: 'official',
    label: 'MiniMax',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['海螺', 'minimaxi'],
    defaultKey: 'minimax-custom',
    sdkBuiltInKey: 'minimax',
    apiKeyPlaceholder: '$MINIMAX_API_KEY',
    accentClass: 'bg-rose-600',
    config: {
      baseUrl: 'https://api.minimax.chat/v1',
      api: 'openai-completions',
    },
  },
  {
    id: 'openrouter',
    category: 'relay',
    label: 'OpenRouter',
    tagline: 'OpenAI-compatible aggregator',
    taglineKey: 'settings:models.presetTaglines.openrouter',
    aliases: ['聚合', 'aggregator', 'or'],
    defaultKey: 'openrouter-custom',
    sdkBuiltInKey: 'openrouter',
    apiKeyPlaceholder: '$OPENROUTER_API_KEY',
    accentClass: 'bg-violet-600',
    config: {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
    },
  },
  {
    id: 'siliconflow',
    category: 'relay',
    label: 'SiliconFlow',
    tagline: 'OpenAI-compatible aggregator',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['硅基流动', '硅基', 'sf'],
    defaultKey: 'siliconflow-custom',
    sdkBuiltInKey: 'siliconflow',
    apiKeyPlaceholder: '$SILICONFLOW_API_KEY',
    accentClass: 'bg-purple-600',
    config: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      api: 'openai-completions',
    },
  },
  {
    id: 'groq',
    category: 'relay',
    label: 'Groq',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['llama', 'fast'],
    defaultKey: 'groq-custom',
    sdkBuiltInKey: 'groq',
    apiKeyPlaceholder: '$GROQ_API_KEY',
    accentClass: 'bg-fuchsia-600',
    config: {
      baseUrl: 'https://api.groq.com/openai/v1',
      api: 'openai-completions',
    },
  },
  {
    id: 'ollama',
    category: 'local',
    label: 'Ollama',
    tagline: 'Local OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.localOpenai',
    aliases: ['本地', 'local', 'llama', 'lmstudio'],
    defaultKey: 'ollama',
    apiKeyPlaceholder: 'ollama',
    accentClass: 'bg-slate-500',
    config: {
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKey: 'ollama',
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    },
  },
]

export function guessPresetForProvider(
  providerId: string,
  config: PiModelsProviderConfig,
): ProviderPreset | undefined {
  const byKey = PROVIDER_PRESETS.find((p) => p.defaultKey === providerId || p.sdkBuiltInKey === providerId)
  if (byKey && byKey.id !== 'custom-openai') return byKey
  const url = (config.baseUrl || '').toLowerCase()
  const api = config.api || ''
  if (url.includes('openai.com')) return PROVIDER_PRESETS.find((p) => p.id === 'openai')
  if (url.includes('anthropic')) return PROVIDER_PRESETS.find((p) => p.id === 'anthropic')
  if (url.includes('generativelanguage') || url.includes('google')) return PROVIDER_PRESETS.find((p) => p.id === 'gemini')
  if (url.includes('deepseek')) return PROVIDER_PRESETS.find((p) => p.id === 'deepseek')
  if (url.includes('groq')) return PROVIDER_PRESETS.find((p) => p.id === 'groq')
  if (url.includes('11434') || url.includes('ollama')) return PROVIDER_PRESETS.find((p) => p.id === 'ollama')
  if (url.includes('openrouter')) return PROVIDER_PRESETS.find((p) => p.id === 'openrouter')
  if (url.includes('siliconflow')) return PROVIDER_PRESETS.find((p) => p.id === 'siliconflow')
  if (url.includes('moonshot')) return PROVIDER_PRESETS.find((p) => p.id === 'moonshot')
  if (url.includes('zhipu') || url.includes('bigmodel')) return PROVIDER_PRESETS.find((p) => p.id === 'zhipu')
  if (url.includes('dashscope') || url.includes('aliyuncs')) return PROVIDER_PRESETS.find((p) => p.id === 'qwen')
  if (url.includes('minimax')) return PROVIDER_PRESETS.find((p) => p.id === 'minimax')
  if (api === 'anthropic-messages') return PROVIDER_PRESETS.find((p) => p.id === 'anthropic')
  if (api === 'google-generative-ai') return PROVIDER_PRESETS.find((p) => p.id === 'gemini')
  return undefined
}

export function allocateProviderKey(existing: Record<string, unknown>, base: string): string {
  if (!(base in existing)) return base
  let n = 2
  while (`${base}-${n}` in existing) n++
  return `${base}-${n}`
}

/**
 * Clone a clean provider skeleton from preset:
 * - Never auto-injects starterModels (prevents unrequested default models polluting the picker)
 * - Never forces a display name unless explicitly set by the user
 */
export function clonePresetConfig(
  preset: ProviderPreset,
  _t?: TFunction,
  _catalog?: UpstreamCatalogSnapshot | null,
): PiModelsProviderConfig {
  const c = JSON.parse(JSON.stringify(preset.config)) as PiModelsProviderConfig
  delete c.name
  c.models = []
  return c
}

export function presetLabel(preset: ProviderPreset | undefined, t: TFunction): string {
  if (!preset) return ''
  return preset.labelKey ? t(preset.labelKey) : preset.label
}

export function presetTagline(preset: ProviderPreset | undefined, t: TFunction): string {
  if (!preset) return ''
  return preset.taglineKey ? t(preset.taglineKey) : preset.tagline
}
