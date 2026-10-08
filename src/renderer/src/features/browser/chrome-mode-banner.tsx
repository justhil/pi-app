import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { capabilityKey, useSessionCapabilitiesStore } from '@renderer/lib/session-capabilities'
import { useUIStore } from '@renderer/stores/ui-store'

type ChromeTab = { tabId: string; title: string; url: string }

/**
 * When this conversation drives the user's Chrome, the Browser panel says so and lists the tabs
 * the agent has open there; clicking one brings that Chrome window forward.
 */
export function ChromeModeBanner() {
  const { t } = useTranslation('browser')
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const usesChrome = useSessionCapabilitiesStore((s) => (s.byKey[capabilityKey(sessionFile)] ?? []).includes('chrome'))
  const [tabs, setTabs] = useState<ChromeTab[]>([])
  const [connected, setConnected] = useState(true)

  useEffect(() => {
    if (!usesChrome) return
    const refresh = () => {
      void ipcClient
        .invoke('browser.chrome.tabs', sessionFile ? { sessionFile } : {})
        .then((res: { tabs?: ChromeTab[] }) => setTabs(res?.tabs ?? []))
        .catch(() => setTabs([]))
      void ipcClient
        .invoke('browser.chrome.status')
        .then((s: { connected?: boolean }) => setConnected(!!s?.connected))
        .catch(() => setConnected(false))
    }
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [usesChrome, sessionFile])

  if (!usesChrome) return null
  return (
    <div className="shrink-0 border-b border-primary/25 bg-primary/5 px-3 py-2 text-[12px]">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <Monitor className="h-3.5 w-3.5 text-primary" />
        {t('chromeMode.title')}
      </div>
      <div className="mt-0.5 text-foreground-secondary">{connected ? t('chromeMode.hint') : t('chromeMode.disconnected')}</div>
      {tabs.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {tabs.map((tab) => (
            <li key={tab.tabId}>
              <button
                type="button"
                title={tab.url}
                className="w-full truncate rounded px-1.5 py-0.5 text-left text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
                onClick={() => void ipcClient.invoke('browser.chrome.focusTab', { tabId: tab.tabId })}
              >
                {tab.title || tab.url}
              </button>
            </li>
          ))}
        </ul>
      ) : connected ? (
        <div className="mt-1 text-muted-foreground">{t('chromeMode.noTabs')}</div>
      ) : null}
    </div>
  )
}
