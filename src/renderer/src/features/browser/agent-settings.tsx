import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { btnOutline, selectCls } from '@renderer/features/settings/settings-controls'
import { SettingRow } from '@renderer/features/settings/settings-page-shared'

type Site = { host: string; bytes: number; updatedAt: number }
type ChromeStatus = { enabled: boolean; listening: boolean; port: number; connected: boolean; browser: string | null; pairingCode: string | null; extensionPath: string }

/** "My Chrome": the pi extension in the user's own Chrome, paired with a code. */
function MyChromeSettings() {
  const { t } = useTranslation('browser')
  const [status, setStatus] = useState<ChromeStatus | null>(null)
  const refresh = () =>
    void ipcClient
      .invoke('browser.chrome.status')
      .then((s: ChromeStatus) => setStatus(s))
      .catch(() => {})
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])
  if (!status) return null
  const toggle = async (enabled: boolean) => {
    try {
      setStatus((await ipcClient.invoke('browser.chrome.setEnabled', { enabled })) as ChromeStatus)
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }
  const copy = async () => {
    if (!status.pairingCode) return
    await navigator.clipboard.writeText(status.pairingCode)
    toast.success(t('settings.chromeCopied'))
  }
  const state = !status.enabled ? '' : status.connected ? t('settings.chromeConnected', { browser: status.browser ?? 'Chrome' }) : status.listening ? t('settings.chromeWaiting') : t('settings.chromeNotListening')
  return (
    <>
      <SettingRow label={t('settings.chrome')} description={t('settings.chromeDesc')}>
        <select className={selectCls} value={status.enabled ? 'on' : 'off'} onChange={(e) => void toggle(e.target.value === 'on')}>
          <option value="off">{t('settings.agentCdpOff')}</option>
          <option value="on">{t('settings.chromeOn')}</option>
        </select>
      </SettingRow>
      {status.enabled ? (
        <div className="-mt-1 mb-2 space-y-2 rounded-md border border-border/50 px-3 py-2.5 text-[12px]">
          <div className={status.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>{state}</div>
          <ol className="list-decimal space-y-1 pl-4 text-foreground-secondary">
            <li>
              {t('settings.chromeStep1')}{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => void ipcClient.invoke('browser.chrome.openExtensionFolder')}>
                {t('settings.chromeOpenFolder')}
              </button>
            </li>
            <li>{t('settings.chromeStep2')}</li>
            <li>{t('settings.chromeStep3')}</li>
          </ol>
          {status.pairingCode ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-[var(--bg-hover)] px-2 py-1 font-mono text-[11px]">{status.pairingCode}</code>
              <button type="button" className={btnOutline} onClick={() => void copy()}>
                {t('settings.chromeCopy')}
              </button>
              <button type="button" className={btnOutline} onClick={() => void ipcClient.invoke('browser.chrome.regenerate').then((s: ChromeStatus) => setStatus(s))}>
                {t('settings.chromeRegenerate')}
              </button>
            </div>
          ) : null}
          <div className="text-muted-foreground">{t('settings.chromeNote')}</div>
        </div>
      ) : null}
    </>
  )
}

/** Agent-side browser options: the DevTools protocol switch and the per-site notes it keeps. */
export function AgentBrowserSettings() {
  const { t } = useTranslation('browser')
  const [cdp, setCdp] = useState<'auto' | 'off'>('auto')
  const [sites, setSites] = useState<Site[]>([])
  const [open, setOpen] = useState<{ host: string; text: string } | null>(null)

  useEffect(() => {
    void ipcClient
      .invoke('settings.get', { key: 'browserAgentCdp' })
      .then((res: { settings?: { browserAgentCdp?: 'auto' | 'off' } } | undefined) => setCdp(res?.settings?.browserAgentCdp ?? 'auto'))
      .catch(() => {})
    void ipcClient
      .invoke('browser.siteNotes.list')
      .then((res: { sites?: Site[] } | undefined) => setSites(res?.sites ?? []))
      .catch(() => {})
  }, [])

  const saveCdp = (value: 'auto' | 'off') => {
    setCdp(value)
    void ipcClient.invoke('settings.set', { key: 'browserAgentCdp', value }).catch(() => toast.error(t('settings.saveFailed')))
  }

  const view = async (host: string) => {
    if (open?.host === host) return setOpen(null)
    const res = (await ipcClient.invoke('browser.siteNotes.read', { host }).catch(() => null)) as { text?: string } | null
    setOpen({ host, text: res?.text ?? '' })
  }

  const remove = async (host: string) => {
    const res = (await ipcClient.invoke('browser.siteNotes.delete', { host }).catch(() => null)) as { sites?: Site[] } | null
    if (res?.sites) setSites(res.sites)
    if (open?.host === host) setOpen(null)
  }

  return (
    <>
      <MyChromeSettings />
      <SettingRow label={t('settings.agentCdp')} description={t('settings.agentCdpDesc')}>
        <select className={selectCls} value={cdp} onChange={(e) => saveCdp(e.target.value as 'auto' | 'off')}>
          <option value="auto">{t('settings.agentCdpAuto')}</option>
          <option value="off">{t('settings.agentCdpOff')}</option>
        </select>
      </SettingRow>
      <SettingRow label={t('settings.siteNotes')} description={t('settings.siteNotesDesc')}>
        {sites.length === 0 ? <span className="text-[12px] text-muted-foreground">{t('settings.siteNotesEmpty')}</span> : null}
      </SettingRow>
      {sites.length ? (
        <div className="-mt-1 mb-2 space-y-1">
          {sites.map((s) => (
            <div key={s.host} className="rounded-md border border-border/50 px-2.5 py-1.5">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate font-mono">{s.host}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{Math.max(1, Math.round(s.bytes / 1024))} KB</span>
                <button type="button" className={btnOutline} onClick={() => void view(s.host)}>
                  {open?.host === s.host ? t('settings.siteNotesHide') : t('settings.siteNotesView')}
                </button>
                <button type="button" className={btnOutline} onClick={() => void remove(s.host)}>
                  {t('settings.siteNotesDelete')}
                </button>
              </div>
              {open?.host === s.host ? <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-foreground-secondary">{open.text}</pre> : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
