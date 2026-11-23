import i18n from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { PiModelsConfigPayload } from '@shared/ipc-contract'
import type { ProviderPreset } from '@renderer/features/settings/model-provider-presets'
import {
  buildModelEntryFromUpstream,
  resolveUpstreamModelSpec,
  type UpstreamCatalogSnapshot,
} from '@shared/models-dev-catalog'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'

export const API_OPTS = [
  { v: 'openai-completions', l: 'OpenAI Chat Completions' },
  { v: 'openai-responses', l: 'OpenAI Responses' },
  { v: 'anthropic-messages', l: 'Anthropic Messages' },
  { v: 'google-generative-ai', l: 'Google Generative AI' },
] as const

export { btnDanger, btnOutline, btnPrimary, inputCls, selectCls } from './settings-controls'

export function cloneConfig(c: PiModelsConfigPayload): PiModelsConfigPayload {
  return JSON.parse(JSON.stringify(c)) as PiModelsConfigPayload
}

export function configEqual(a: PiModelsConfigPayload | null, b: PiModelsConfigPayload | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function maskApiKey(key?: string): string {
  if (!key) return i18n.t('settings:models.notConfigured')
  if (key.startsWith('$')) return key
  if (key.startsWith('!')) return '!command'
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-2)}`
}

export function ProviderAvatar({ preset, label }: { preset?: ProviderPreset; label: string }) {
  const trimmed = label.trim()
  const firstChar = trimmed.charAt(0)
  const avatarText = /[\u4e00-\u9fff]/.test(firstChar)
    ? firstChar
    : trimmed.slice(0, 2).toUpperCase()
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white shadow-xs transition-transform duration-motion-fast ease-motion-ease',
        preset?.accentClass ?? 'bg-muted-foreground/45',
      )}
      title={label}
    >
      {avatarText}
    </span>
  )
}

export function defaultModelEntry(
  id: string,
  opts?: {
    catalog?: UpstreamCatalogSnapshot | null
    providerId?: string
    baseUrl?: string
  },
): LocalModelEntry {
  const spec = resolveUpstreamModelSpec(opts?.catalog, id, {
    providerId: opts?.providerId,
    baseUrl: opts?.baseUrl,
  })
  return buildModelEntryFromUpstream(id, spec)
}

export function formatContextK(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

export function formatShortPrice(cost?: { input?: number; output?: number }): string {
  if (!cost) return ''
  const hasIn = typeof cost.input === 'number'
  const hasOut = typeof cost.output === 'number'
  if (!hasIn && !hasOut) return ''
  const fmt = (v?: number) => (typeof v === 'number' ? `$${Number(v.toFixed(3))}` : '—')
  return `${fmt(cost.input)}/${fmt(cost.output)}`
}