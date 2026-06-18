// Settings page with 6 sub-pages

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { Settings as SettingsIcon, Palette, Cpu, Puzzle, Package, Stethoscope } from 'lucide-react'

type SettingsPage = 'general' | 'appearance' | 'pi' | 'extensions' | 'resources' | 'diagnostics'

const PAGES: { key: SettingsPage; icon: any; labelKey: string }[] = [
  { key: 'general', icon: SettingsIcon, labelKey: 'settings.general' },
  { key: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
  { key: 'pi', icon: Cpu, labelKey: 'settings.pi' },
  { key: 'extensions', icon: Puzzle, labelKey: 'settings.extensions' },
  { key: 'resources', icon: Package, labelKey: 'settings.resources' },
  { key: 'diagnostics', icon: Stethoscope, labelKey: 'settings.diagnostics' },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState<SettingsPage>('general')

  return (
    <div className="flex h-full">
      {/* Settings sidebar */}
      <div className="w-48 border-r border-border bg-muted/20">
        {PAGES.map((p) => (
          <button
            key={p.key}
            onClick={() => setPage(p.key)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors duration-motion-fast ease-motion-ease',
              page === p.key
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <p.icon className="h-4 w-4" />
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto p-4">
        {page === 'general' && <GeneralSettings />}
        {page === 'appearance' && <AppearanceSettings />}
        {page === 'pi' && <PiSettings />}
        {page === 'extensions' && <ExtensionsSettings />}
        {page === 'resources' && <ResourcesSettings />}
        {page === 'diagnostics' && <DiagnosticsSettings />}
      </div>
    </div>
  )
}

function GeneralSettings() {
  return <div className="space-y-4 text-sm">
    <h3 className="text-base font-semibold">常规</h3>
    <div>启动行为、最近项目、registry 自动检查 - 待实现</div>
  </div>
}

function AppearanceSettings() {
  const { t } = useTranslation()
  return <div className="space-y-4 text-sm">
    <h3 className="text-base font-semibold">{t('settings.appearance')}</h3>
    <div className="space-y-2">
      <label className="text-muted-foreground">主题</label>
      <div className="flex gap-2">
        {['light', 'dark', 'system'].map(theme => (
          <button key={theme} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors duration-motion-fast ease-motion-ease">
            {t(`settings.theme.${theme}`)}
          </button>
        ))}
      </div>
    </div>
  </div>
}

function PiSettings() {
  return <div className="space-y-4 text-sm">
    <h3 className="text-base font-semibold">Pi</h3>
    <div className="space-y-1 text-muted-foreground">
      <div>SDK Version: 内置</div>
      <div>agentDir: ~/.pi/agent</div>
      <div>Auth: 检测中...</div>
    </div>
  </div>
}

function ExtensionsSettings() {
  return <div className="space-y-4 text-sm">
    <h3 className="text-base font-semibold">插件</h3>
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-md border border-border p-2">
        <div>
          <div className="font-medium">Trellis</div>
          <div className="text-xs text-muted-foreground">native · 已启用</div>
        </div>
        <div className="h-5 w-9 rounded-full bg-primary" />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border p-2">
        <div>
          <div className="font-medium">Ask</div>
          <div className="text-xs text-muted-foreground">native · 已启用</div>
        </div>
        <div className="h-5 w-9 rounded-full bg-primary" />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border p-2">
        <div>
          <div className="font-medium">Image</div>
          <div className="text-xs text-muted-foreground">native · 已启用</div>
        </div>
        <div className="h-5 w-9 rounded-full bg-primary" />
      </div>
    </div>
  </div>
}

function ResourcesSettings() {
  return <div className="space-y-4 text-sm">
    <h3 className="text-base font-semibold">资源</h3>
    <div className="text-muted-foreground">skills / prompts / MCP / themes / packages - 待实现</div>
  </div>
}

function DiagnosticsSettings() {
  return <div className="space-y-4 text-sm">
    <h3 className="text-base font-semibold">诊断</h3>
    <div className="space-y-1 font-mono text-xs text-muted-foreground">
      <div>Worker: 空闲</div>
      <div>Registry: 未检查</div>
      <div>Errors: 无</div>
    </div>
  </div>
}
