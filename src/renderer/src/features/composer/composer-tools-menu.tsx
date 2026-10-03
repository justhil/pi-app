import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CapabilityId, CapabilityInfo } from '@shared/capabilities'
import { Globe, SlidersHorizontal, Sparkles, type AppIconComponent } from '@renderer/components/icons'
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
  const names = enabled.map(label).join('、')

  return (
    <div className="flex min-w-0 items-center">
      {/* One icon button. Enabled capabilities show as a small count (names in the tooltip
          and the menu), so turning things on never widens the toolbar. */}
      <button
        type="button"
        data-composer-tools=""
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={enabled.length ? t('composer:tools.enabledTitle', { names }) : t('composer:tools.button')}
        title={enabled.length ? t('composer:tools.enabledTitle', { names }) : t('composer:tools.button')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'composer-toolbar-btn flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-foreground-secondary/75 disabled:opacity-30',
          open && 'bg-[var(--bg-active)] text-foreground',
          enabled.length > 0 && 'text-primary',
        )}
      >
        <SlidersHorizontal className="h-[14px] w-[14px]" />
        {enabled.map((id) => (
          <span key={id} className="composer-capability-chip hidden" data-capability={id} />
        ))}
        {enabled.length > 0 ? <span className="text-[11px] tabular-nums">{enabled.length}</span> : null}
      </button>
      {open ? (
        <ComposerPopover
          anchorSelector="[data-composer-tools]"
          align="start"
          width={280}
          label={t('composer:tools.title')}
          onClose={() => setOpen(false)}
        >
          <div className="px-3 pb-0.5 pt-2 text-[10.5px] text-muted-foreground/65">{t('composer:tools.title')}</div>
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
                  className={cn('flex items-start gap-2 px-3 py-1.5', cap.available ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'opacity-55')}
                >
                  <Icon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-foreground">{label(cap.id)}</div>
                    <div className="text-[10.5px] leading-4 text-muted-foreground/70">{t(`composer:tools.items.${cap.id}.desc`)}</div>
                    {cost ? <div className="text-[10px] tabular-nums text-muted-foreground/55">{cost}</div> : null}
                  </div>
                  <Switch
                    checked={on}
                    disabled={!cap.available}
                    aria-label={label(cap.id)}
                    onCheckedChange={(next) => setSessionCapability(sessionFile, cap.id, next)}
                    className="mt-0.5 origin-top-right scale-75"
                  />
                </label>
              )
            })}
          </div>
          <div className="border-t border-border/50 px-3 py-1.5 text-[10px] leading-4 text-muted-foreground/60">
            {running ? t('composer:tools.noteRunning') : t('composer:tools.note')}
          </div>
        </ComposerPopover>
      ) : null}
    </div>
  )
}
