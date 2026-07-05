import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { Switch } from '@renderer/components/ui/switch'

export function ExtensionsSettings() {
  const { t } = useTranslation()
  interface ExtRow {
    id: string
    name?: string
    source?: string
    description?: string
    compatibility?: string
    piSync?: boolean
    piEnabled?: boolean
    enabled?: boolean
    inSettingsPackages?: boolean
    workerLoadHint?: string
    loadError?: string
    registeredTools?: string[]
    registeredCommands?: string[]
    adapterId?: string
    tuiOnly?: boolean
  }
  type MissingPkg = { entry: string; repoFolder: string }
  const [extensions, setExtensions] = useState<ExtRow[]>([])
  const [runtimeTools, setRuntimeTools] = useState<Array<{ name?: string }>>([])
  const [missingRuntime, setMissingRuntime] = useState<MissingPkg[]>([])
  const [syncing, setSyncing] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const refreshExtensions = () => {
    ipcClient.invoke('extensions.list').then((res) => {
      setExtensions(res?.extensions || [])
    })
    ipcClient.invoke('extensions.missingRuntimePackages').then((res) => {
      setMissingRuntime(res?.missing || [])
    })
    ipcClient.invoke('runtime.getState').then((res) => {
      setRuntimeTools(Array.isArray(res?.state?.tools) ? res.state.tools : [])
    }).catch(() => setRuntimeTools([]))
  }

  useEffect(() => {
    refreshExtensions()
  }, [])

  const handleToggle = async (ext: ExtRow) => {
    if (!ext.piSync) {
      toast.error(ext.inSettingsPackages === false ? t('settings:extensions.workerLoadHint') : t('settings:extensions.notSynced'))
      return
    }
    const next = !(ext.piEnabled ?? ext.enabled)
    setTogglingId(ext.id)
    try {
      const res = await ipcClient.invoke('extensions.setEnabled', { extensionId: ext.id, enabled: next })
      if (!res?.ok) {
        toast.error(res?.error || t('common:saveFailed'))
        return
      }
      toast.success(next ? t('settings:extensions.piEnabled') : t('settings:extensions.piDisabled'))
      refreshExtensions()
    } catch (e) {
      toast.error(t('common:operationFailed'))
    } finally {
      setTogglingId(null)
    }
  }

  const COMPAT_STYLES: Record<string, string> = {
    native: 'bg-green-500/10 text-green-600 dark:text-green-400',
    basic: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    headless: 'bg-muted text-muted-foreground',
    blocked: 'bg-destructive/10 text-destructive',
  }

  const COMPAT_LABELS: Record<string, string> = {
    native: t('settings:extensions.compatNative'),
    basic: t('settings:extensions.compatBasic'),
    headless: t('settings:extensions.compatHeadless'),
    blocked: t('settings:extensions.compatBlocked'),
  }

  const runtimeNames = new Set(runtimeTools.map((t) => t.name))
  const watchedTools = ['fast_context_search', 'search', 'search_sources', 'ffgrep', 'fffind']

  return (
    <div className="space-y-1 w-full">
      <SettingsPageHeader
        title={t('settings:extensions.title')}
        description={t('settings:extensions.description')}
      />
      {missingRuntime.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/8 p-3">
          <div className="text-[12px] font-medium text-amber-800 dark:text-amber-200">{t('settings:extensions.missingRuntime')}</div>
          <p className="mt-1 text-[11px] text-foreground-secondary leading-relaxed">
            {t('settings:extensions.missingRuntimeDesc')}
          </p>
          <ul className="mt-2 space-y-1 text-[11px] font-mono text-foreground-secondary">
            {missingRuntime.map((m) => (
              <li key={m.entry}>· {m.repoFolder} → {m.entry}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={syncing}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground disabled:opacity-50"
            onClick={() => {
              setSyncing(true)
              ipcClient.invoke('extensions.syncGitPackages').then((r) => {
                if (r?.added?.length) toast.success(t('settings:extensions.syncSuccess', { list: r.added.join(', ') }))
                else if (r?.error) toast.error(r.error)
                refreshExtensions()
              }).catch(() => toast.error(t('settings:extensions.syncFailed'))).finally(() => setSyncing(false))
            }}
          >
            {syncing ? t('settings:extensions.syncing') : t('settings:extensions.writePackages')}
          </button>
        </div>
      )}
      <div className="mb-3 rounded-lg border border-border/50 bg-muted/20 p-2.5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t('settings:extensions.workerTools')} {runtimeTools.length ? `(${runtimeTools.length})` : t('settings:extensions.workerToolsEmpty')}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {watchedTools.map((name) => (
            <span
              key={name}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                runtimeNames.has(name) ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground/45',
              )}
            >
              {runtimeNames.has(name) ? '✓ ' : '· '}{name}
            </span>
          ))}
        </div>
      </div>
      {extensions.length === 0 ? (
        <div className="text-[12px] text-muted-foreground/50 py-4">
          {t('settings:extensions.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {extensions.map((ext) => {
            const isOn = ext.piEnabled ?? ext.enabled
            const canToggle = ext.piSync === true
            return (
              <div key={`${ext.source}-${ext.id}`} className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{ext.name}</span>
                      <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider', COMPAT_STYLES[ext.compatibility ?? ''])}>
                        {COMPAT_LABELS[ext.compatibility ?? ''] || ext.compatibility}
                      </span>
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase',
                        ext.source === 'project' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}>
                        {ext.source === 'package' ? t('settings:extensions.sourcePackage') : ext.source === 'project' ? t('settings:extensions.sourceProject') : t('settings:extensions.sourceGlobal')}
                      </span>
                      {ext.piSync ? (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[9px] font-medium',
                            isOn ? 'bg-green-500/12 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {isOn ? t('settings:extensions.piEnabled') : t('settings:extensions.piDisabled')}
                        </span>
                      ) : (
                        <span className="rounded px-1.5 py-0.5 text-[9px] text-muted-foreground">{t('settings:extensions.notSynced')}</span>
                      )}
                    </div>
                    {ext.description && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground/75 truncate">{ext.description}</div>
                    )}
                    {(ext.registeredTools?.length ?? 0) > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(ext.registeredTools ?? []).map((t: string) => (
                          <span key={t} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {(ext.registeredCommands?.length ?? 0) > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(ext.registeredCommands ?? []).map((c: string) => (
                          <span key={c} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            /{c}
                          </span>
                        ))}
                      </div>
                    )}
                    {ext.adapterId ? (
                      <div className="mt-1 text-[10px] text-green-700 dark:text-green-400">
                        {t('settings:extensions.adapterLinked')}<span className="font-medium">{ext.adapterId}</span>
                      </div>
                    ) : ext.tuiOnly ? (
                      <div className="mt-1 text-[10px] text-muted-foreground/70 italic">
                        {t('settings:extensions.tuiOnly')}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-muted-foreground/55 italic">
                        {t('settings:extensions.noAdapter')}
                      </div>
                    )}
                    {ext.inSettingsPackages === false && ext.workerLoadHint && (
                      <div className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-900 dark:text-amber-200">
                        {ext.workerLoadHint}
                      </div>
                    )}
                    {ext.loadError && (
                      <div className="mt-1 text-[10px] text-destructive">{ext.loadError}</div>
                    )}
                  </div>
                  <Switch
                    checked={isOn}
                    onCheckedChange={() => void handleToggle(ext)}
                    disabled={!canToggle || togglingId === ext.id}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

