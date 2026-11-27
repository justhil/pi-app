import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Monitor, Plus, Undo2 } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { capabilityKey, useSessionCapabilitiesStore } from '@renderer/lib/session-capabilities'
import { useUIStore } from '@renderer/stores/ui-store'

type ChromeManagedTab = { tabId: string; title: string; url: string; borrowed?: boolean }
type ChromeUserTab = { chromeTabId: number; title: string; url: string }

/**
 * Interactive Chrome Bridge control bar inside BrowserPanel:
 * - Shows connected status & live managed/borrowed Chrome tabs (click to focus, 1-click Return)
 * - Includes a quick "Borrow Chrome Tab ▾" picker to lend any open Chrome tab to Pi on the spot
 */
export function ChromeModeBanner() {
  const { t } = useTranslation('browser')
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const usesChrome = useSessionCapabilitiesStore((s) =>
    (s.byKey[capabilityKey(sessionFile)] ?? []).includes('chrome'),
  )
  const [tabs, setTabs] = useState<ChromeManagedTab[]>([])
  const [userTabs, setUserTabs] = useState<ChromeUserTab[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [connected, setConnected] = useState(true)

  const refresh = useCallback(() => {
    void ipcClient
      .invoke('browser.chrome.tabs', sessionFile ? { sessionFile } : {})
      .then((res: { tabs?: ChromeManagedTab[] }) => setTabs(res?.tabs ?? []))
      .catch(() => setTabs([]))
    void ipcClient
      .invoke('browser.chrome.status')
      .then((s: { connected?: boolean }) => setConnected(!!s?.connected))
      .catch(() => setConnected(false))
  }, [sessionFile])

  useEffect(() => {
    if (!usesChrome) return
    refresh()
    const timer = setInterval(refresh, 2500)
    return () => clearInterval(timer)
  }, [usesChrome, refresh])

  const openBorrowPicker = async () => {
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    setPickerOpen(true)
    try {
      const res = (await ipcClient.invoke('browser.chrome.userTabs')) as { tabs?: ChromeUserTab[] }
      setUserTabs(res?.tabs ?? [])
    } catch {
      setUserTabs([])
    }
  }

  const borrowTab = async (chromeTabId: number) => {
    setPickerOpen(false)
    try {
      await ipcClient.invoke('browser.chrome.borrowTab', {
        chromeTabId,
        ...(sessionFile ? { sessionFile } : {}),
      })
      toast.success(t('chromeMode.borrowedToast'))
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('send.failed'))
    }
  }

  const returnTab = async (tabId: string) => {
    await ipcClient.invoke('browser.chrome.returnTab', { tabId }).catch(() => {})
    refresh()
  }

  if (!usesChrome) return null
  return (
    <div className="shrink-0 border-b border-primary/25 bg-primary/5 px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Monitor className="h-3.5 w-3.5 text-primary" />
          <span>{t('chromeMode.title')}</span>
        </div>

        {connected ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => void openBorrowPicker()}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)]"
            >
              <Plus className="h-3 w-3" />
              <span>{t('chromeMode.borrowBtn')}</span>
              <ChevronDown className="h-3 w-3 opacity-65" />
            </button>

            {pickerOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} aria-hidden />
                <div
                  role="menu"
                  data-browser-overlay=""
                  className="absolute right-0 top-7 z-50 max-h-[240px] w-[268px] overflow-y-auto rounded-lg border border-border/70 bg-popover p-1 text-[11.5px] text-popover-foreground shadow-xl"
                >
                  {userTabs.length === 0 ? (
                    <div className="px-2.5 py-4 text-center text-muted-foreground">
                      {t('chromeMode.noUserTabs')}
                    </div>
                  ) : (
                    userTabs.map((ut) => (
                      <button
                        key={ut.chromeTabId}
                        type="button"
                        role="menuitem"
                        title={ut.url}
                        onClick={() => void borrowTab(ut.chromeTabId)}
                        className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                      >
                        <span className="w-full truncate font-medium text-foreground">
                          {ut.title || ut.url}
                        </span>
                        <span className="w-full truncate font-mono text-[10.5px] text-muted-foreground">
                          {ut.url.replace(/^https?:\/\//i, '')}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-0.5 text-[11.5px] text-foreground-secondary">
        {connected ? t('chromeMode.hint') : t('chromeMode.disconnected')}
      </div>

      {tabs.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {tabs.map((tab) => (
            <li key={tab.tabId} className="group flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]">
              <button
                type="button"
                title={tab.url}
                className="min-w-0 flex-1 truncate text-left text-foreground-secondary group-hover:text-foreground"
                onClick={() => void ipcClient.invoke('browser.chrome.focusTab', { tabId: tab.tabId })}
              >
                {tab.title || tab.url}
              </button>
              {tab.borrowed ? (
                <button
                  type="button"
                  title={t('chromeMode.returnBtn')}
                  onClick={() => void returnTab(tab.tabId)}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.2 text-[10.5px] text-muted-foreground hover:bg-[var(--bg-active)] hover:text-foreground"
                >
                  <Undo2 className="h-2.5 w-2.5" />
                  <span>{t('chromeMode.returnBtn')}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : connected ? (
        <div className="mt-1 text-[11.5px] text-muted-foreground">{t('chromeMode.noTabs')}</div>
      ) : null}
    </div>
  )
}
