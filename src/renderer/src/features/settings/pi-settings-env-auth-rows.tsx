import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, AlertCircle, Loader2, Copy, FolderOpen } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingRow } from './settings-page-shared'
import { btnOutline } from './settings-controls'
import { type PiInfo, type PiSettingsSnapshot } from './pi-settings-shared'

function PiPathRow() {
  const { t } = useTranslation()
  const [path, setPath] = useState('')
  const [ok, setOk] = useState<boolean | null>(null)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void ipcClient.invoke('desktop.whichPi', {}).then((res) => {
      setOk(res?.ok === true)
      setPath(String(res?.path || ''))
    }).catch(() => setError(true))
  }, [])
  return (
    <SettingRow label={t('settings:pi.pathTitle')} description={t('settings:pi.pathDesc')}>
      <div className="flex w-full max-w-[340px] flex-col gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" title={path} role="status">
          {ok === null && !error ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : ok ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success-semantic)]" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 truncate font-mono">{error ? t('common:operationFailed') : ok === null ? t('common:loading') : ok ? path : t('settings:pi.pathMissing')}</span>
        </span>
        {path ? <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btnOutline} inline-flex items-center gap-1.5`} onClick={() => { void navigator.clipboard.writeText(path).then(() => setCopied(true)).catch(() => setError(true)) }}>
            <Copy className="h-3.5 w-3.5" />{copied ? t('settings:copied') : t('settings:pi.pathCopy')}
          </button>
          <button type="button" className={`${btnOutline} inline-flex items-center gap-1.5`} onClick={() => void ipcClient.invoke('shell.showItemInFolder', { path })}>
            <FolderOpen className="h-3.5 w-3.5" />{t('settings:pi.reveal')}
          </button>
        </div> : null}
      </div>
    </SettingRow>
  )
}

export function PiSettingsEnvAuthRows({ info, ui }: { info: PiInfo | null; ui: PiSettingsSnapshot }) {
  const { t } = useTranslation()
  const reveal = (path?: string | null) => {
    if (!path) return
    void ipcClient.invoke('shell.showItemInFolder', { path })
  }
  return (
    <>
      <PiPathRow />
      <SettingRow label={t('settings:pi.agentDir')} description={t('settings:pi.agentDirDesc')}>
        <div className="flex max-w-[280px] items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={info?.agentDir}>
            {info?.agentDir || '~/.pi/agent'}
          </span>
          <button type="button" className={btnOutline} onClick={() => reveal(info?.agentDir)}>
            {t('settings:pi.reveal')}
          </button>
        </div>
      </SettingRow>
      <SettingRow label={t('settings:pi.auth')} description={t('settings:pi.providerDesc')}>
        {(info?.authProviders?.length ?? 0) > 0 || info?.authStatus === 'configured' ? (
          <div className="flex max-w-xs flex-wrap items-center gap-1.5 sm:justify-end">
            <Check className="h-3.5 w-3.5 text-[var(--success-semantic)]" strokeWidth={2} />
            {(info?.authProviders ?? []).map((p) => (
              <span key={p.provider} className="rounded-md border border-border/60 bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[11px]">
                {p.provider}
              </span>
            ))}
            {(info?.authProviders?.length ?? 0) === 0 ? (
              <span className="text-[12.5px] text-[var(--success-semantic)]">{t('settings:pi.authConfigured')}</span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={2} />
            <span className="text-[12.5px] text-muted-foreground">{t('settings:pi.authNotConfigured')}</span>
          </div>
        )}
      </SettingRow>
      <SettingRow label={t('settings:pi.sessionDir')} description={t('settings:pi.sessionDirDesc')}>
        <div className="flex max-w-[280px] items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {String(ui?.sessionDir || t('settings:pi.sessionDirDefault'))}
          </span>
          {ui?.sessionDir ? (
            <button type="button" className={btnOutline} onClick={() => reveal(String(ui.sessionDir))}>
              {t('settings:pi.reveal')}
            </button>
          ) : null}
        </div>
      </SettingRow>
    </>
  )
}
