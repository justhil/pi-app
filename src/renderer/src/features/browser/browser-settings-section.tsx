import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BROWSER_SEARCH_ENGINE_IDS, DEFAULT_ELECTRON_PROFILE_ID, type BrowserDownloader, type BrowserSearchEngine } from '@shared/browser-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { btnDanger, btnOutline, selectCls } from '@renderer/features/settings/settings-controls'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'

/** Built-in browser options; saved immediately (not part of the settings draft). */
export function BrowserSettingsSection() {
  const { t } = useTranslation('browser')
  const [engine, setEngine] = useState<BrowserSearchEngine>('bing')
  const [confirmClear, setConfirmClear] = useState(false)
  const [downloader, setDownloader] = useState<BrowserDownloader>('auto')
  const [aria2Path, setAria2Path] = useState('')
  const [connections, setConnections] = useState(16)
  const [aria2, setAria2] = useState<{ path: string | null; version: string | null } | null>(null)

  const refreshAria2 = (path: string) =>
    void ipcClient
      .invoke('browser.downloader.status', { aria2Path: path })
      .then((res: { path: string | null; version: string | null }) => setAria2(res))
      .catch(() => setAria2({ path: null, version: null }))

  useEffect(() => {
    void ipcClient
      .invoke('settings.get', { key: 'browserSearchEngine' })
      .then((res: { settings?: { browserSearchEngine?: BrowserSearchEngine } } | undefined) => {
        if (res?.settings?.browserSearchEngine) setEngine(res.settings.browserSearchEngine)
      })
      .catch(() => {})
    void Promise.all(['browserDownloader', 'browserAria2Path', 'browserDownloadConnections'].map((key) => ipcClient.invoke('settings.get', { key }).catch(() => null)))
      .then(([d, p, c]) => {
        const settings = { ...d?.settings, ...p?.settings, ...c?.settings } as { browserDownloader?: BrowserDownloader; browserAria2Path?: string; browserDownloadConnections?: number }
        if (settings.browserDownloader) setDownloader(settings.browserDownloader)
        setAria2Path(settings.browserAria2Path ?? '')
        if (settings.browserDownloadConnections) setConnections(settings.browserDownloadConnections)
        refreshAria2(settings.browserAria2Path ?? '')
      })
  }, [])

  const save = async (key: string, value: unknown) => {
    try {
      await ipcClient.invoke('settings.set', { key, value })
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const pickAria2 = async () => {
    const res = (await ipcClient.invoke('dialog:openFiles', { multiple: false, title: t('settings.aria2Pick') }).catch(() => null)) as { paths?: string[] } | null
    const path = res?.paths?.[0]
    if (!path) return
    setAria2Path(path)
    await save('browserAria2Path', path)
    refreshAria2(path)
  }

  const saveEngine = async (next: BrowserSearchEngine) => {
    setEngine(next)
    try {
      await ipcClient.invoke('settings.set', { key: 'browserSearchEngine', value: next })
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const clearData = async () => {
    setConfirmClear(false)
    try {
      await ipcClient.invoke('browser.profile.clear', { profileId: DEFAULT_ELECTRON_PROFILE_ID })
      toast.success(t('settings.cleared'))
    } catch {
      toast.error(t('settings.clearFailed'))
    }
  }

  return (
    <SettingsSection title={t('settings.title')} description={t('settings.description')}>
      <SettingRow label={t('settings.searchEngine')} settingKey="browserSearchEngine">
        <select
          className={selectCls}
          value={engine}
          onChange={(e) => void saveEngine(e.target.value as BrowserSearchEngine)}
        >
          {BROWSER_SEARCH_ENGINE_IDS.map((id) => (
            <option key={id} value={id}>{t(`settings.engines.${id}`)}</option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('settings.downloader')} description={t('settings.downloaderDesc')}>
        <select
          className={selectCls}
          value={downloader}
          onChange={(e) => {
            const next = e.target.value as BrowserDownloader
            setDownloader(next)
            void save('browserDownloader', next)
          }}
        >
          <option value="auto">{t('settings.downloaderAuto')}</option>
          <option value="electron">{t('settings.downloaderElectron')}</option>
        </select>
      </SettingRow>
      {downloader === 'auto' ? (
        <>
          <SettingRow
            label={t('settings.aria2')}
            description={
              aria2 === null
                ? t('settings.aria2Checking')
                : aria2.path
                  ? t('settings.aria2Found', { version: aria2.version ?? '?', path: aria2.path })
                  : aria2Path
                    ? t('settings.aria2Invalid')
                    : t('settings.aria2Missing')
            }
          >
            <div className="flex items-center gap-2">
              {aria2Path ? (
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => {
                    setAria2Path('')
                    void save('browserAria2Path', '')
                    refreshAria2('')
                  }}
                >
                  {t('settings.aria2Auto')}
                </button>
              ) : null}
              <button type="button" className={btnOutline} onClick={() => void pickAria2()}>
                {t('settings.aria2Pick')}
              </button>
            </div>
          </SettingRow>
          <SettingRow label={t('settings.connections')} description={t('settings.connectionsDesc')}>
            <input
              type="number"
              min={1}
              max={16}
              value={connections}
              onChange={(e) => {
                const n = Math.max(1, Math.min(16, Math.floor(Number(e.target.value)) || 1))
                setConnections(n)
                void save('browserDownloadConnections', n)
              }}
              className="h-8 w-20 rounded-md border border-border/60 bg-transparent px-2 text-sm tabular-nums"
            />
          </SettingRow>
        </>
      ) : null}
      <SettingRow label={t('settings.clearData')} description={t('settings.clearDataDesc')}>
        <button type="button" className={btnDanger} onClick={() => setConfirmClear(true)}>
          {t('settings.clearDataAction')}
        </button>
      </SettingRow>
      <ConfirmDialog
        open={confirmClear}
        title={t('settings.clearData')}
        message={t('settings.clearDataConfirm')}
        destructive
        onConfirm={() => void clearData()}
        onCancel={() => setConfirmClear(false)}
      />
    </SettingsSection>
  )
}
