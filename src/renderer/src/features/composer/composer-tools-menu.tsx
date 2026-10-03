import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CapabilityId, CapabilityInfo } from '@shared/capabilities'
import { Globe, SlidersHorizontal, Sparkles, X, type AppIconComponent } from '@renderer/components/icons'
import { Switch } from '@renderer/components/ui/switch'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  capabilityKey,
  loadSessionCapabilities,
  onCapabilityKeyChange,
  setSessionCapability,
  useSessionCapabilitiesStore,
} from '@renderer/lib/session-capabilities'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ComposerPopover } from './composer-popover'

const ICONS: Record<CapabilityId, AppIconComponent> = { 'pi-ui': Sparkles, browser: Globe }
const EMPTY: CapabilityId[] = []

let catalogCache: CapabilityInfo[] | null = null

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/**
 * Composer "Tools" menu: per-session capability switches (all off for a new session). An enabled
 * capability adds its instructions/tools from the next message on; switching it off removes them.
 */
export function ComposerToolsMenu({ disabled, running }: { disabled?: boolean; running?: boolean }) {
  const { t } = useTranslation()
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const key = capabilityKey(sessionFile)
  const enabled = useSessionCapabilitiesStore((s) => s.byKey[key]) ?? EMPTY
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CapabilityInfo[] | null>(catalogCache)
  const prevKey = useRef(key)

  useEffect(() => {
    void loadSessionCapabilities()
  }, [])

  useEffect(() => {
    onCapabilityKeyChange(prevKey.current, key)
    prevKey.current = key
  }, [key])

  useEffect(() => {
    // Availability follows settings (e.g. the Browser panel experiment): refresh on every open.
    if (!open) return
    void ipcClient
      .invoke('capabilities.catalog')
      .then((res: { capabilities?: CapabilityInfo[] }) => {
        catalogCache = res?.capabilities ?? []
        setCatalog(catalogCache)
      })
      .catch(() => setCatalog([]))
  }, [open])

  const label = (id: CapabilityId) => t(`composer:tools.items.${id}.name`)

  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        data-composer-tools=""
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('composer:tools.button')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'composer-toolbar-btn flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-foreground-secondary/80 disabled:opacity-30',
          open && 'bg-[var(--bg-active)] text-foreground',
        )}
      >
        <SlidersHorizontal className="h-[14px] w-[14px]" />
        {enabled.length === 0 ? <span>{t('composer:tools.button')}</span> : null}
      </button>
      {enabled.map((id) => {
        const Icon = ICONS[id]
        return (
          <span key={id} className="composer-capability-chip flex h-6 min-w-0 items-center gap-1 rounded-md pl-1.5 pr-0.5 text-[11px]">
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{label(id)}</span>
            <button
              type="button"
              aria-label={t('composer:tools.turnOff', { name: label(id) })}
              title={t('composer:tools.turnOff', { name: label(id) })}
              onClick={() => setSessionCapability(sessionFile, id, false)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-60 hover:bg-[var(--bg-hover)] hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}
      {open ? (
        <ComposerPopover
          anchorSelector="[data-composer-tools]"
          align="start"
          width={312}
          label={t('composer:tools.title')}
          onClose={() => setOpen(false)}
        >
          <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground/80">{t('composer:tools.title')}</div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-1">
            {(catalog ?? []).map((cap) => {
              const Icon = ICONS[cap.id]
              const on = enabled.includes(cap.id)
              const cost = !cap.available
                ? t(cap.reason ? `composer:tools.reasons.${cap.reason}` : 'composer:tools.comingSoon')
                : [cap.tools > 0 ? t('composer:tools.toolCount', { count: cap.tools }) : '', cap.promptTokens > 0 ? t('composer:tools.tokens', { n: formatTokens(cap.promptTokens) }) : '']
                    .filter(Boolean)
                    .join(' · ')
              return (
                <label
                  key={cap.id}
                  className={cn('flex items-start gap-2.5 px-3 py-2', cap.available ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'opacity-55')}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-foreground">{label(cap.id)}</div>
                    <div className="text-[11px] leading-4 text-muted-foreground/80">{t(`composer:tools.items.${cap.id}.desc`)}</div>
                    {cost ? <div className="mt-0.5 text-[10.5px] tabular-nums text-muted-foreground/60">{cost}</div> : null}
                  </div>
                  <Switch
                    checked={on}
                    disabled={!cap.available}
                    aria-label={label(cap.id)}
                    onCheckedChange={(next) => setSessionCapability(sessionFile, cap.id, next)}
                  />
                </label>
              )
            })}
          </div>
          <div className="border-t border-border/60 px-3 py-2 text-[10.5px] leading-4 text-muted-foreground/70">
            {running ? t('composer:tools.noteRunning') : t('composer:tools.note')}
          </div>
        </ComposerPopover>
      ) : null}
    </div>
  )
}
