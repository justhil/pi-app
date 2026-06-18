import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { Settings as SettingsIcon, Palette, Cpu, Puzzle, Package, Stethoscope, Moon, Sun, Monitor, Bell, Folder, Zap } from 'lucide-react'

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
      <div className="w-48 border-r border-border/80 bg-muted/20">
        <div className="px-3 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
          {t('settings.title')}
        </div>
        {PAGES.map((p) => (
          <button
            key={p.key}
            onClick={() => setPage(p.key)}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-all duration-motion-fast ease-motion-ease',
              page === p.key
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            )}
          >
            <p.icon className="h-4 w-4" />
            {t(p.labelKey)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl">
          {page === 'general' && <GeneralSettings />}
          {page === 'appearance' && <AppearanceSettings />}
          {page === 'pi' && <PiSettings />}
          {page === 'extensions' && <ExtensionsSettings />}
          {page === 'resources' && <ResourcesSettings />}
          {page === 'diagnostics' && <DiagnosticsSettings />}
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, description, children }: any) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/40 last:border-0">
      <div className="flex-1">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {description && <div className="text-[11px] text-muted-foreground/60 mt-0.5">{description}</div>}
      </div>
      <div className="ml-4 shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors duration-motion-fast ease-motion-ease',
        on ? 'bg-primary' : 'bg-muted-foreground/20'
      )}
    >
      <div className={cn(
        'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-motion-fast ease-motion-ease',
        on ? 'left-4' : 'left-0.5'
      )} />
    </button>
  )
}

function GeneralSettings() {
  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">常规</h3>
      <SettingRow label="启动时打开上次项目" description="自动恢复上次打开的项目目录">
        <Toggle on={true} onChange={() => {}} />
      </SettingRow>
      <SettingRow label="自动检查更新" description="启动时检查适配器 registry 更新">
        <Toggle on={true} onChange={() => {}} />
      </SettingRow>
      <SettingRow label="最近项目数量" description="保留的最近项目数量">
        <span className="text-[13px] text-muted-foreground tabular-nums">10</span>
      </SettingRow>
    </div>
  )
}

function AppearanceSettings() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

  const themes: { key: 'light' | 'dark' | 'system'; icon: any }[] = [
    { key: 'light', icon: Sun },
    { key: 'dark', icon: Moon },
    { key: 'system', icon: Monitor },
  ]

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">{t('settings.appearance')}</h3>
      <SettingRow label={t('settings.theme.title') || '主题'} description="选择界面主题">
        <div className="flex gap-1.5">
          {themes.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTheme(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all duration-motion-fast ease-motion-ease',
                theme === key
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/50'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`settings.theme.${key}`)}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="字号" description="界面文字大小">
        <span className="text-[13px] text-muted-foreground">13px</span>
      </SettingRow>
    </div>
  )
}

function PiSettings() {
  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">Pi</h3>
      <SettingRow label="SDK 版本" description="内置 pi-coding-agent 版本">
        <span className="text-[13px] font-mono text-muted-foreground">0.79.x</span>
      </SettingRow>
      <SettingRow label="agentDir" description="pi 配置目录">
        <span className="text-[12px] font-mono text-muted-foreground">~/.pi/agent</span>
      </SettingRow>
      <SettingRow label="认证状态" description="API key / OAuth">
        <span className="text-[12px] text-muted-foreground">检测中...</span>
      </SettingRow>
    </div>
  )
}

function ExtensionsSettings() {
  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">插件</h3>
      <div className="space-y-2">
        {[
          { name: 'Trellis', level: 'native', enabled: true },
          { name: 'Ask', level: 'native', enabled: true },
          { name: 'Image', level: 'native', enabled: true },
        ].map((ext) => (
          <div key={ext.name} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 p-2.5">
            <div>
              <div className="text-[13px] font-medium">{ext.name}</div>
              <div className="text-[11px] text-muted-foreground/60">
                <span className={cn(
                  'rounded px-1.5 py-0.5 font-medium',
                  ext.level === 'native' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-muted'
                )}>
                  {ext.level}
                </span>
              </div>
            </div>
            <Toggle on={ext.enabled} onChange={() => {}} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ResourcesSettings() {
  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">资源</h3>
      <SettingRow label="Skills" description="已安装的技能">
        <span className="text-[13px] text-muted-foreground tabular-nums">0</span>
      </SettingRow>
      <SettingRow label="Prompts" description="已安装的提示模板">
        <span className="text-[13px] text-muted-foreground tabular-nums">0</span>
      </SettingRow>
      <SettingRow label="Themes" description="已安装的主题">
        <span className="text-[13px] text-muted-foreground tabular-nums">0</span>
      </SettingRow>
    </div>
  )
}

function DiagnosticsSettings() {
  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">诊断</h3>
      <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
        <div className="text-muted-foreground">
          <span className="text-green-500">●</span> Worker: 空闲
        </div>
        <div className="text-muted-foreground">
          <span className="text-muted-foreground/40">●</span> Registry: 未检查
        </div>
        <div className="text-muted-foreground">
          <span className="text-muted-foreground/40">●</span> Errors: 无
        </div>
      </div>
    </div>
  )
}
