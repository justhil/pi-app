import type { ReactNode } from 'react'
import { Switch } from '@renderer/components/ui/switch'

export type PiSettingsSnapshot = Record<string, unknown>

export type PiInfo = {
  sdkVersion?: string
  agentDir?: string
  authStatus?: string
  authProviders?: Array<{ provider?: string }>
}

export type SdkStatus = {
  builtinVersion?: string
  globalVersion?: string
  userVersion?: string
  npmAvailable?: boolean
  workerFallback?: boolean
  active?: { version?: string; kind?: 'builtin' | 'global' | 'user'; fallbackReason?: string }
}

export function settingsEqual(a: PiSettingsSnapshot | null, b: PiSettingsSnapshot | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pt-5 first:pt-0">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{title}</div>
      <div className="rounded-lg border border-border/50 bg-card/20 px-3">{children}</div>
    </div>
  )
}

export function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 border-b border-border/40 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-[11px] text-muted-foreground/65">{description}</div>}
      </div>
      <div className="shrink-0 sm:ml-4">{children}</div>
    </div>
  )
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Switch checked={on} onCheckedChange={onChange} disabled={disabled} />
}

export const selectCls = 'max-w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] min-w-[10rem]'
export const inputCls = 'w-full max-w-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono'
export const btnPrimary =
  'rounded-md bg-primary px-2.5 py-1.5 text-[12px] text-primary-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none'
export const btnOutline =
  'rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-40 disabled:pointer-events-none hover:bg-accent'