import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BROWSER_SEARCH_ENGINE_IDS, DEFAULT_ELECTRON_PROFILE_ID, type BrowserSearchEngine } from '@shared/browser-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { btnDanger, selectCls } from '@renderer/features/settings/settings-controls'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'

/** Built-in browser options; saved immediately (not part of the settings draft). */
export function BrowserSettingsSection() {
  const { t } = useTranslation('browser')
  const [engine, setEngine] = useState<BrowserSearchEngine>('bing')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void ipcClient
      .invoke('settings.get', { key: 'browserSearchEngine' })
      .then((res: { settings?: { browserSearchEngine?: BrowserSearchEngine } } | undefined) => {
        if (res?.settings?.browserSearchEngine) setEngine(res.settings.browserSearchEngine)
      })
      .catch(() => {})
  }, [])

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
