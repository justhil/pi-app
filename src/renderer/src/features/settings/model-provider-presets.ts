import type { PiModelsProviderConfig } from '@shared/ipc-contract'
import {
  buildModelEntryFromUpstream,
  resolveUpstreamModelSpec,
  type UpstreamCatalogSnapshot,
} from '@shared/models-dev-catalog'
import type { TFunction } from 'i18next'

export type ProviderPresetId =
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
  | 'custom-openai'

export type ProviderPresetCategory = 'official' | 'relay' | 'local'

export type ProviderPreset = {
  id: ProviderPresetId
  category: ProviderPresetCategory
  label: string
  /** Locale key for presets whose brand is written differently per language (智谱 GLM / Zhipu GLM). */
  labelKey?: string
  tagline: string
  /** Locale key for the preset tagline shown in the template selector. */
  taglineKey?: string
  /** Extra search terms (Chinese/English aliases, domain keywords) for quick preset search. */
  aliases?: string[]
  /** 建议写入 models.json 的 provider 键 */
  defaultKey: string
  accentClass: string
  config: PiModelsProviderConfig
  starterModels?: { id: string; name?: string }[]
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    category: 'official',
    label: 'OpenAI',
    tagline: 'Official or OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openai',
    aliases: ['gpt', 'chatgpt', 'o3', 'codex'],
    defaultKey: 'openai',
    accentClass: 'bg-emerald-500',
    config: {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      apiKey: '$OPENAI_API_KEY',
    },
    starterModels: [
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'o3', name: 'o3' },
    ],
  },
  {
    id: 'anthropic',
    category: 'official',
    label: 'Anthropic',
    tagline: 'Claude Messages API',
    taglineKey: 'settings:models.presetTaglines.anthropic',
    aliases: ['claude', 'sonnet', 'opus'],
    defaultKey: 'anthropic',
    accentClass: 'bg-orange-500',
    config: {
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      apiKey: '$ANTHROPIC_API_KEY',
    },
    starterModels: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1' },
    ],
  },
  {
    id: 'gemini',
    category: 'official',
    label: 'Google Gemini',
    tagline: 'Gemini API',
    taglineKey: 'settings:models.presetTaglines.gemini',
    aliases: ['google', 'gemini'],
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
    category: 'official',
    label: 'DeepSeek',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['深度求索', 'ds', 'r1', 'v3'],
    defaultKey: 'deepseek',
    accentClass: 'bg-cyan-600',
    config: {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      api: 'openai-completions',
      apiKey: '$DEEPSEEK_API_KEY',
    },
    starterModels: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ],
  },
  {
    id: 'moonshot',
    category: 'official',
    label: 'Moonshot / Kimi',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['kimi', '月之暗面'],
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
    category: 'official',
    label: 'Zhipu GLM',
    labelKey: 'settings:models.presetZhipu',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['智谱', 'glm', 'bigmodel'],
    defaultKey: 'zhipu',
    accentClass: 'bg-indigo-600',
    config: {
      name: '智谱',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      api: 'openai-completions',
      apiKey: '$ZHIPU_API_KEY',
    },
    starterModels: [{ id: 'glm-5', name: 'GLM-5' }],
  },
  {
    id: 'qwen',
    category: 'official',
    label: 'Qwen / DashScope',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['通义千问', '阿里云', '百炼', 'dashscope', 'alibaba'],
    defaultKey: 'qwen',
    accentClass: 'bg-sky-600',
    config: {
      name: 'Qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
      apiKey: '$DASHSCOPE_API_KEY',
    },
    starterModels: [{ id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' }],
  },
  {
    id: 'minimax',
    category: 'official',
    label: 'MiniMax',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['海螺', 'minimaxi'],
    defaultKey: 'minimax',
    accentClass: 'bg-rose-600',
    config: {
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.chat/v1',
      api: 'openai-completions',
      apiKey: '$MINIMAX_API_KEY',
    },
  },
  {
    id: 'openrouter',
    category: 'relay',
    label: 'OpenRouter',
    tagline: 'OpenAI-compatible aggregator',
    taglineKey: 'settings:models.presetTaglines.openrouter',
    aliases: ['聚合', 'aggregator', 'or'],
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
    id: 'siliconflow',
    category: 'relay',
    label: 'SiliconFlow',
    tagline: 'OpenAI-compatible aggregator',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['硅基流动', '硅基', 'sf'],
    defaultKey: 'siliconflow',
    accentClass: 'bg-purple-600',
    config: {
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      api: 'openai-completions',
      apiKey: '$SILICONFLOW_API_KEY',
    },
  },
  {
    id: 'groq',
    category: 'relay',
    label: 'Groq',
    tagline: 'OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.openaiCompatible',
    aliases: ['llama', 'fast'],
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
    category: 'local',
    label: 'Ollama',
    tagline: 'Local OpenAI-compatible',
    taglineKey: 'settings:models.presetTaglines.localOpenai',
    aliases: ['本地', 'local', 'llama', 'lmstudio'],
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
    id: 'custom-openai',
    category: 'relay',
    label: 'Custom relay',
    labelKey: 'settings:models.presetCustomRelay',
    tagline: 'Custom baseUrl',
    taglineKey: 'settings:models.presetTaglines.customBaseUrl',
    aliases: ['中转', '自定义', '代理', 'proxy', 'newapi', 'oneapi', 'relay'],
    defaultKey: 'my-proxy',
    accentClass: 'bg-muted-foreground/50',
    config: {
      name: 'Custom relay',
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

export function clonePresetConfig(
  preset: ProviderPreset,
  t?: TFunction,
  catalog?: UpstreamCatalogSnapshot | null,
): PiModelsProviderConfig {
  const c = JSON.parse(JSON.stringify(preset.config)) as PiModelsProviderConfig
  if (t && preset.labelKey) {
    c.name = presetLabel(preset, t)
  }
  if (preset.starterModels?.length) {
    c.models = preset.starterModels.map((m) => {
      const spec = resolveUpstreamModelSpec(catalog, m.id, {
        providerId: preset.defaultKey,
        baseUrl: preset.config.baseUrl,
      })
      if (spec) {
        const built = buildModelEntryFromUpstream(m.id, spec)
        return { ...built, name: m.name || built.name }
      }
      return { ...m }
    })
  } else {
    c.models = c.models ? [...c.models] : []
  }
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
