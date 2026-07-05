import i18n from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { PiModelsConfigPayload } from '@shared/ipc-contract'
import type { ProviderPreset } from '@renderer/features/settings/model-provider-presets'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'

export const API_OPTS = [
  { v: 'openai-completions', l: 'OpenAI Chat Completions' },
  { v: 'openai-responses', l: 'OpenAI Responses' },
  { v: 'anthropic-messages', l: 'Anthropic Messages' },
  { v: 'google-generative-ai', l: 'Google Generative AI' },
] as const

export const inputCls =
  'settings-field-focus w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono'
export const selectCls = 'settings-field-focus rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px]'
export const btnOutline =
  'settings-chip rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] disabled:opacity-40'
export const btnPrimary =
  'settings-chip rounded-md bg-primary px-2.5 py-1.5 text-[12px] text-primary-foreground disabled:opacity-40'

export function cloneConfig(c: PiModelsConfigPayload): PiModelsConfigPayload {
  return JSON.parse(JSON.stringify(c)) as PiModelsConfigPayload
}

export function configEqual(a: PiModelsConfigPayload | null, b: PiModelsConfigPayload | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function maskApiKey(key?: string): string {
  if (!key) return i18n.t('models:notConfigured')
  if (key.startsWith('$')) return key
  if (key.startsWith('!')) return '!command'
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-2)}`
}

export function ProviderAvatar({ preset, label }: { preset?: ProviderPreset; label: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm transition-transform duration-motion-fast ease-motion-ease',
        preset?.accentClass ?? 'bg-muted-foreground/40',
      )}
      title={label}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  )
}

export function defaultModelEntry(id: string): LocalModelEntry {
  const guessReasoning = /^(o\d|gpt-5|claude-opus|deepseek-reasoner|think)/i.test(id)
  const guessVision = /(vision|gpt-4o|gemini|claude-3|image)/i.test(id)
  return {
    id,
    name: id,
    reasoning: guessReasoning || undefined,
    input: guessVision ? ['text', 'image'] : ['text'],
    ...(guessReasoning ? { thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } } : {}),
  }
}