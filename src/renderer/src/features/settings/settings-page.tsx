import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { ExtensionConfigSubpage } from '@renderer/features/extension-ui/extension-config-subpage'
import { ModelsSettingsPanel } from '@renderer/features/settings/models-settings-panel'
import { Settings as SettingsIcon, Palette, Cpu, Puzzle, Zap, MessageSquareText, Mic,
  Layers, ChevronLeft, LayoutPanelLeft, Boxes, type LucideIcon
} from 'lucide-react'
import { SkillsSettingsPanel } from '@renderer/features/settings/skills-settings-panel'
import { PromptsSettingsPanel } from '@renderer/features/settings/prompts-settings-panel'
import {
  SettingsMain,
  SettingsNav,
  SettingsNavItem,
  SettingsPageHeader,
} from '@renderer/features/settings/settings-shell'
import { RightPanelsSettings } from '@renderer/features/settings/right-panels-settings'
import { VoiceSettingsPanel } from '@renderer/features/settings/voice-settings-panel'
import { SettingsDraftProvider } from '@renderer/features/settings/settings-draft-context'
import { SettingsSaveBar } from '@renderer/features/settings/settings-save-bar'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'
import { GeneralSettings, AppearanceSettings, PiSettings } from '@renderer/features/settings/settings-general-appearance'
import { ExtensionsSettings } from '@renderer/features/settings/settings-extensions-panel'
import { AdaptersSettings } from '@renderer/features/settings/settings-adapters-panel'

type SettingsPage = 'general' | 'appearance' | 'rightPanels' | 'pi' | 'models' | 'skills' | 'prompts' | 'extensions' | 'adapters' | 'voice'

export function SettingsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState<SettingsPage>('general')
  const [configExt, setConfigExt] = useState<string | null>(null)
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

  const PAGES: { key: SettingsPage; icon: LucideIcon; label: string }[] = [
    { key: 'general', icon: SettingsIcon, label: t('settings:nav.general') },
    { key: 'appearance', icon: Palette, label: t('settings:nav.appearance') },
    { key: 'rightPanels', icon: LayoutPanelLeft, label: t('settings:nav.rightPanels') },
    { key: 'pi', icon: Cpu, label: t('settings:nav.pi') },
    { key: 'models', icon: Boxes, label: t('settings:nav.models') },
    { key: 'skills', icon: Zap, label: t('settings:nav.skills') },
    { key: 'prompts', icon: MessageSquareText, label: t('settings:nav.prompts') },
    { key: 'extensions', icon: Puzzle, label: t('settings:nav.extensions') },
    { key: 'adapters', icon: Layers, label: t('settings:nav.adapters') },
    { key: 'voice', icon: Mic, label: t('settings:nav.voice') },
  ]

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

  // Config detail subpage (replaces modal)
  if (configExt) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setConfigExt(null)}
            className="electron-no-drag chrome-icon-btn flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t('settings:adapters.backToAdapters')}
          </button>
          <span className="text-[13px] font-medium">{t('settings:adapters.configTitle', { id: configExt })}</span>
        </div>
        <SettingsMain wide>
          <div className="animate-in fade-in slide-in-from-right duration-motion-normal">
            <ExtensionConfigSubpage extensionId={configExt} />
          </div>
        </SettingsMain>
      </div>
    )
  }

  const widePages: SettingsPage[] = ['rightPanels', 'pi', 'models', 'skills', 'prompts', 'extensions', 'adapters', 'voice']
  const wide = widePages.includes(page)

  return (
    <SettingsDraftProvider>
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <SettingsNav title={t('settings:title')}>
          {PAGES.map((p) => (
            <SettingsNavItem
              key={p.key}
              active={page === p.key}
              icon={p.icon}
              label={p.label}
              onClick={() => setPage(p.key)}
            />
          ))}
        </SettingsNav>
        <SettingsMain wide={wide} footer={<SettingsSaveBar />}>
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
        </SettingsMain>
      </div>
    </SettingsDraftProvider>
  )
}
