import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { ExtensionConfigSubpage } from '@renderer/features/extension-ui/extension-config-subpage'
import { ModelsSettingsPanel } from '@renderer/features/settings/models-settings-panel'
import { SlidersHorizontal, Palette, Cpu, Puzzle, Zap, MessageSquareText, Mic,
  Cable, ChevronLeft, LayoutPanelLeft, Boxes, Search, X, type AppIconComponent
} from '@renderer/components/icons'
import { SkillsSettingsPanel } from '@renderer/features/settings/skills-settings-panel'
import { PromptsSettingsPanel } from '@renderer/features/settings/prompts-settings-panel'
import {
  SettingsMain,
  SettingsNav,
  SettingsNavGroup,
  SettingsNavItem,
} from '@renderer/features/settings/settings-shell'
import { RightPanelsSettings } from '@renderer/features/settings/right-panels-settings'
import { VoiceSettingsPanel } from '@renderer/features/settings/voice-settings-panel'
import { SettingsDraftProvider } from '@renderer/features/settings/settings-draft-context'
import { SettingsSaveBar } from '@renderer/features/settings/settings-save-bar'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'
import { GeneralSettings, AppearanceSettings, PiSettings } from '@renderer/features/settings/settings-general-appearance'
import { ExtensionsSettings } from '@renderer/features/settings/settings-extensions-panel'
import { SettingsSearchContext } from './settings-page-shared'
import { AdaptersSettings } from '@renderer/features/settings/settings-adapters-panel'

type SettingsPage = 'general' | 'appearance' | 'rightPanels' | 'pi' | 'models' | 'skills' | 'prompts' | 'extensions' | 'adapters' | 'voice'

type NavGroup = { key: string; labelKey: string; pages: { key: SettingsPage; icon: AppIconComponent }[] }

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'app',
    labelKey: 'settings:nav.groupApp',
    pages: [
      { key: 'general', icon: SlidersHorizontal },
      { key: 'appearance', icon: Palette },
      { key: 'rightPanels', icon: LayoutPanelLeft },
    ],
  },
  {
    key: 'agent',
    labelKey: 'settings:nav.groupAgent',
    pages: [
      { key: 'pi', icon: Cpu },
      { key: 'models', icon: Boxes },
      { key: 'voice', icon: Mic },
    ],
  },
  {
    key: 'resources',
    labelKey: 'settings:nav.groupResources',
    pages: [
      { key: 'skills', icon: Zap },
      { key: 'prompts', icon: MessageSquareText },
      { key: 'extensions', icon: Puzzle },
      { key: 'adapters', icon: Cable },
    ],
  },
]

const WIDE_PAGES: SettingsPage[] = ['rightPanels', 'pi', 'models', 'skills', 'prompts', 'extensions', 'adapters', 'voice']

export function SettingsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState<SettingsPage>('general')
  const [settingsQuery, setSettingsQuery] = useState('')
  const [configExt, setConfigExt] = useState<string | null>(null)
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

  // 外置 adapter.json 可能在设置外被修改；进入设置时刷新 Main 缓存与右栏目录
  useEffect(() => {
    invalidateRightPanelCatalog()
    void ipcClient.invoke('adapters.json.catalog', { refresh: true })
  }, [])

  // B-layer slash config-page routing -> open embedded config subpage
  useEffect(() => {
    if (pendingExtensionConfig) {
      setConfigExt(pendingExtensionConfig)
      setPage('adapters')
      requestExtensionConfig(null)
    }
  }, [pendingExtensionConfig, requestExtensionConfig])

  const wide = WIDE_PAGES.includes(page)
  const filteredGroups = useMemo(() => {
    const query = settingsQuery.trim().toLocaleLowerCase()
    return NAV_GROUPS.map((group) => ({ ...group, pages: group.pages.filter((item) => {
      if (!query) return true
      const text = `${item.key} ${t(`settings:nav.${item.key}`)} ${JSON.stringify(t(`settings:${item.key}`, { returnObjects: true }))} ${item.key === 'general' ? JSON.stringify(t('common:shortcuts', { returnObjects: true })) : ''}`
      return text.toLocaleLowerCase().includes(query)
    }) })).filter((group) => group.pages.length > 0)
  }, [settingsQuery, t])
  const pages = filteredGroups.flatMap((group) => group.pages)
  const selectedVisible = pages.some((item) => item.key === page)
  const firstMatch = pages[0]?.key
  useEffect(() => {
    if (!selectedVisible && firstMatch) setPage(firstMatch)
  }, [selectedVisible, firstMatch])

  return (
    <SettingsDraftProvider>
      <SettingsSearchContext.Provider value={settingsQuery}>
      <div className="settings-layout flex h-full min-h-0 w-full overflow-hidden">
        <SettingsNav title={t('settings:title')}>
          <div className="workbench-search mx-1">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <input type="search" value={settingsQuery} aria-label={t('settings:search')} placeholder={t('settings:search')} onChange={(event) => { setSettingsQuery(event.target.value); setConfigExt(null) }} />
            {settingsQuery && <button type="button" className="workbench-icon" aria-label={t('common:sidebar.clearSearch')} onClick={() => setSettingsQuery('')}><X className="h-3.5 w-3.5" /></button>}
          </div>
          {filteredGroups.map((group) => (
            <SettingsNavGroup key={group.key} label={t(group.labelKey)}>
              {group.pages.map((p) => (
                <SettingsNavItem
                  key={p.key}
                  active={page === p.key}
                  icon={p.icon}
                  label={t(`settings:nav.${p.key}`)}
                  onClick={() => {
                    setConfigExt(null)
                    setPage(p.key)
                  }}
                />
              ))}
            </SettingsNavGroup>
          ))}
        </SettingsNav>

        {configExt ? (
          // 适配器配置子页：仍不进草稿、不挂保存栏，仅在主区替换内容
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-[var(--bg-base)] px-4 py-2.5">
              <button
                type="button"
                onClick={() => setConfigExt(null)}
                className="electron-no-drag chrome-icon-btn flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" strokeWidth={2} />
                {t('settings:adapters.backToAdapters')}
              </button>
              <span className="text-base font-medium">{t('settings:adapters.configTitle', { id: configExt })}</span>
            </div>
            <SettingsMain wide>
              <div className="animate-in fade-in slide-in-from-right duration-motion-normal">
                <ExtensionConfigSubpage extensionId={configExt} />
              </div>
            </SettingsMain>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {settingsQuery.trim() && <div className="settings-search-summary flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-2 text-xs text-foreground-secondary"><span role="status">{t('settings:searchResults', { count: pages.length })}</span><button type="button" className="workbench-button" onClick={() => setSettingsQuery('')}>{t('common:sidebar.clearSearch')}</button></div>}
          <SettingsMain wide={wide} footer={<SettingsSaveBar wide={wide} />}>
            {pages.length === 0 ? <div className="workbench-empty"><Search className="h-6 w-6 opacity-50" /><p>{t('settings:noSearchResults')}</p><span>{t('settings:searchHint')}</span></div> : <>
            {page === 'general' && <GeneralSettings />}
            {page === 'appearance' && <AppearanceSettings />}
            {page === 'rightPanels' && <RightPanelsSettings />}
            {page === 'pi' && <PiSettings />}
            {page === 'models' && <ModelsSettingsPanel />}
            {page === 'skills' && <SkillsSettingsPanel />}
            {page === 'prompts' && <PromptsSettingsPanel />}
            {page === 'extensions' && <ExtensionsSettings />}
            {page === 'adapters' && <AdaptersSettings />}
            {page === 'voice' && <VoiceSettingsPanel />}
            </>}
          </SettingsMain>
          </div>
        )}
      </div>
      </SettingsSearchContext.Provider>
    </SettingsDraftProvider>
  )
}
