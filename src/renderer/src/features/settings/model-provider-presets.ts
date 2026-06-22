import type { PiModelsProviderConfig } from '@shared/ipc-contract'

export type ProviderPresetId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'groq'
  | 'ollama'
  | 'openrouter'
  | 'moonshot'
  | 'zhipu'
  | 'custom-openai'

export type ProviderPreset = {
  id: ProviderPresetId
  label: string
  tagline: string
  /** 建议写入 models.json 的 provider 键 */
  defaultKey: string
  accentClass: string
  config: PiModelsProviderConfig
  starterModels?: { id: string; name?: string }[]
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    tagline: '官方或 OpenAI 兼容',
    defaultKey: 'openai',
    accentClass: 'bg-emerald-500',
    config: {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-completions',
      apiKey: '$OPENAI_API_KEY',
    },
    starterModels: [
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'o3', name: 'o3' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    tagline: 'Claude Messages API',
    defaultKey: 'anthropic',
    accentClass: 'bg-orange-500',
    config: {
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      apiKey: '$ANTHROPIC_API_KEY',
    },
    starterModels: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    tagline: 'Gemini API',
    defaultKey: 'google',
    accentClass: 'bg-blue-500',
    config: {
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      api: 'google-generative-ai',
      apiKey: '$GEMINI_API_KEY',
    },
    starterModels: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    tagline: 'OpenAI 兼容',
    defaultKey: 'deepseek',
    accentClass: 'bg-cyan-600',
    config: {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      api: 'openai-completions',
      apiKey: '$DEEPSEEK_API_KEY',
    },
    starterModels: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }, { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }],
  },
  {
    id: 'groq',
    label: 'Groq',
    tagline: 'OpenAI 兼容',
    defaultKey: 'groq',
    accentClass: 'bg-fuchsia-600',
    config: {
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      api: 'openai-completions',
      apiKey: '$GROQ_API_KEY',
    },
    starterModels: [{ id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' }],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    tagline: '本地 OpenAI 兼容',
    defaultKey: 'ollama',
    accentClass: 'bg-slate-500',
    config: {
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKey: 'ollama',
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    },
    starterModels: [{ id: 'llama3.1:8b' }, { id: 'qwen2.5-coder:7b' }],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: 'OpenAI 兼容聚合',
    defaultKey: 'openrouter',
    accentClass: 'bg-violet-600',
    config: {
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKey: '$OPENROUTER_API_KEY',
    },
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    tagline: 'OpenAI 兼容',
    defaultKey: 'moonshot',
    accentClass: 'bg-amber-600',
    config: {
      name: 'Moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
      apiKey: '$MOONSHOT_API_KEY',
    },
    starterModels: [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    tagline: 'OpenAI 兼容',
    defaultKey: 'zhipu',
    accentClass: 'bg-indigo-600',
    config: {
      name: '智谱',
      baseUrl: 'https://openai.zhipuai.cn/api/paas/v4',
      api: 'openai-completions',
      apiKey: '$ZHIPU_API_KEY',
    },
    starterModels: [{ id: 'glm-4-plus', name: 'GLM-4 Plus' }],
  },
  {
    id: 'custom-openai',
    label: '自定义中转',
    tagline: '自定义 baseUrl',
    defaultKey: 'my-proxy',
    accentClass: 'bg-muted-foreground/50',
    config: {
      name: '自定义中转',
      baseUrl: 'https://your-proxy.example.com/v1',
      api: 'openai-completions',
      apiKey: '$MY_API_KEY',
    },
  },
]

export function guessPresetForProvider(
  providerId: string,
  config: PiModelsProviderConfig,
): ProviderPreset | undefined {
  const byKey = PROVIDER_PRESETS.find((p) => p.defaultKey === providerId)
  if (byKey) return byKey
  const url = (config.baseUrl || '').toLowerCase()
  const api = config.api || ''
  if (url.includes('openai.com')) return PROVIDER_PRESETS.find((p) => p.id === 'openai')
  if (url.includes('anthropic')) return PROVIDER_PRESETS.find((p) => p.id === 'anthropic')
  if (url.includes('generativelanguage') || url.includes('google')) return PROVIDER_PRESETS.find((p) => p.id === 'gemini')
  if (url.includes('deepseek')) return PROVIDER_PRESETS.find((p) => p.id === 'deepseek')
  if (url.includes('groq')) return PROVIDER_PRESETS.find((p) => p.id === 'groq')
  if (url.includes('11434') || url.includes('ollama')) return PROVIDER_PRESETS.find((p) => p.id === 'ollama')
  if (url.includes('openrouter')) return PROVIDER_PRESETS.find((p) => p.id === 'openrouter')
  if (url.includes('moonshot')) return PROVIDER_PRESETS.find((p) => p.id === 'moonshot')
  if (url.includes('zhipu')) return PROVIDER_PRESETS.find((p) => p.id === 'zhipu')
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

export function clonePresetConfig(preset: ProviderPreset): PiModelsProviderConfig {
  const c = JSON.parse(JSON.stringify(preset.config)) as PiModelsProviderConfig
  if (preset.starterModels?.length) {
    c.models = preset.starterModels.map((m) => ({ ...m }))
  } else {
    c.models = c.models ? [...c.models] : []
  }
  return c
}