import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { resolveAdapterText } from '@extension-compat/adapter-schema'
import i18n from '@renderer/lib/i18n'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'

const TIER_STYLES: Record<string, string> = {
  native: 'bg-green-500/10 text-green-700 dark:text-green-400',
  partial: 'bg-amber-500/10 text-amber-800 dark:text-amber-400',
  headless: 'bg-muted text-muted-foreground',
  none: 'bg-muted text-muted-foreground',
}

export function AdaptersSettings() {
  const { t } = useTranslation()
  type AdapterRow = {
    id: string
    pluginId?: string
    displayName?: string
    tier?: string
    source?: string
    version?: string
    adapterVersion?: string
    description?: string
    desktopSupport?: string
    adapterJson?: Parameters<typeof resolveAdapterText>[0]
    matchMeta?: { probeId?: string; npmPackage?: string }
    registeredTools?: string[]
  }
  const [adapters, setAdapters] = useState<AdapterRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

  const TIER_LABELS: Record<string, string> = {
    native: t('settings:adapters.tierNative'),
    partial: t('settings:adapters.tierPartial'),
    headless: t('settings:adapters.tierHeadless'),
    none: t('settings:adapters.tierNone'),
  }

  useEffect(() => {
    setError(null)
    // v2-only catalog: adapters.catalog already merges probed plugins with v2 adapter.json + orphans.
    ipcClient
      .invoke('adapters.catalog')
      .then((res) => {
        setAdapters(Array.isArray(res?.adapters) ? res.adapters : [])
      })
      .catch((e) => {
        setAdapters([])
        setError(String(e))
      })
  }, [])

  if (adapters === null) {
    return <div className="text-[12px] text-muted-foreground/50 py-4">{t('settings:adapters.loading')}</div>
  }

  return (
    <div className="w-full space-y-3">
      <SettingsPageHeader
        title={t('settings:adapters.title')}
        description={t('settings:adapters.description')}
      />
      {error && <div className="text-[11px] text-destructive">{error}</div>}
      {adapters.length === 0 ? (
        <div className="text-[12px] text-muted-foreground/50 py-4">
          {t('settings:adapters.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {adapters.map((a) => {
            const resolved = a.adapterJson ? resolveAdapterText(a.adapterJson, i18n.language) : null
            return (
            <div key={a.pluginId} className="rounded-lg border border-border/60 bg-card/40 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-medium">{resolved?.displayName || a.displayName}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', TIER_STYLES[a.tier ?? ''])}>
                  {TIER_LABELS[a.tier ?? ''] || a.tier}
                </span>
                <span className="text-[10px] text-muted-foreground">{a.source}</span>
                {a.version && <span className="text-[10px] font-mono text-muted-foreground">v{a.version}</span>}
                {a.adapterVersion && (
                  <span className="text-[10px] text-muted-foreground">{t('settings:adapters.tierPartial')} v{a.adapterVersion}</span>
                )}
              </div>
              {(resolved?.description || a.description) && <p className="mt-1 text-[12px] text-muted-foreground/80">{resolved?.description || a.description}</p>}
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{t('settings:adapters.desktop')}</span>
                {resolved?.description || a.desktopSupport}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground/60 font-mono">
                probe: {a.matchMeta?.probeId}
                {a.matchMeta?.npmPackage ? ` · npm: ${a.matchMeta.npmPackage}` : ''}
              </div>
              {(a.registeredTools?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {(a.registeredTools ?? []).map((t: string) => (
                    <span key={t} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">{t}</span>
                  ))}
                </div>
              )}
              {a.tier !== 'none' && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => requestExtensionConfig(a.id)}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-accent"
                  >
                    {t('settings:adapters.openConfig')}
                  </button>
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
