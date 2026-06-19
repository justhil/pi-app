import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  Settings as SettingsIcon, Palette, Cpu, Puzzle, Package, Stethoscope,
  Moon, Sun, Monitor, Check, AlertCircle, Folder, Zap, Wrench
} from 'lucide-react'

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
  const { i18n } = useTranslation()
  const [autoOpen, setAutoOpen] = useState(true)
  const [autoCheck, setAutoCheck] = useState(true)
  const [recentProjects, setRecentProjects] = useState<string[]>([])

  useEffect(() => {
    ipcClient.invoke('settings.get', { key: 'recentProjects' }).then((res) => {
      if (res?.settings?.recentProjects) setRecentProjects(res.settings.recentProjects)
    })
  }, [])

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">常规</h3>
      <SettingRow label="启动时打开上次项目" description="自动恢复上次打开的项目目录">
        <Toggle on={autoOpen} onChange={setAutoOpen} />
      </SettingRow>
      <SettingRow label="自动检查更新" description="启动时检查适配器 registry 更新">
        <Toggle on={autoCheck} onChange={setAutoCheck} />
      </SettingRow>
      <SettingRow label="语言" description="界面语言">
        <div className="flex gap-1.5">
          {[
            { key: 'zh', label: '中文' },
            { key: 'en', label: 'English' },
          ].map((l) => (
            <button
              key={l.key}
              onClick={() => i18n.changeLanguage(l.key)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-[12px] transition-all duration-motion-fast ease-motion-ease',
                i18n.language === l.key
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/50',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </SettingRow>
      {recentProjects.length > 0 && (
        <div className="pt-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">最近项目</div>
          <div className="space-y-1">
            {recentProjects.map((p, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-2.5 py-1.5 text-[12px]">
                <Folder className="h-3 w-3 text-muted-foreground/50" />
                <span className="truncate font-mono text-muted-foreground">{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AppearanceSettings() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

  useEffect(() => {
    ipcClient.invoke('settings.get', { key: 'theme' }).then((res) => {
      if (res?.settings?.theme) setTheme(res.settings.theme)
    })
  }, [])

  const applyTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme)
    ipcClient.invoke('settings.set', { key: 'theme', value: newTheme })
    // Apply to document
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else if (newTheme === 'light') {
      document.documentElement.classList.remove('dark')
    } else {
      // System
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', isDark)
    }
  }

  const themes: { key: 'light' | 'dark' | 'system'; icon: any }[] = [
    { key: 'light', icon: Sun },
    { key: 'dark', icon: Moon },
    { key: 'system', icon: Monitor },
  ]

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">{t('settings.appearance')}</h3>
      <SettingRow label="主题" description="选择界面主题">
        <div className="flex gap-1.5">
          {themes.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => applyTheme(key)}
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
    </div>
  )
}

function PiSettings() {
  const [info, setInfo] = useState<any>(null)

  useEffect(() => {
    ipcClient.invoke('pi.getInfo').then(setInfo).catch(() => {})
  }, [])

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">Pi</h3>
      <SettingRow label="SDK 版本" description="内置 pi-coding-agent 版本">
        <span className="text-[13px] font-mono text-muted-foreground">{info?.sdkVersion || '...'}</span>
      </SettingRow>
      <SettingRow label="agentDir" description="pi 配置目录">
        <span className="text-[12px] font-mono text-muted-foreground">{info?.agentDir || '~/.pi/agent'}</span>
      </SettingRow>
      <SettingRow label="认证状态" description="API key / OAuth / 订阅">
        <div className="flex items-center gap-1.5">
          {info?.authStatus === 'configured' ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span className="text-[12px] text-green-600 dark:text-green-400">已配置</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-[12px] text-muted-foreground">未配置</span>
            </>
          )}
        </div>
      </SettingRow>
      {info?.authProviders?.length > 0 && (
        <div className="pt-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">已配置的 Provider</div>
          <div className="space-y-1">
            {info.authProviders.map((p: any) => (
              <div key={p.provider} className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-2.5 py-1.5 text-[12px]">
                <span className="font-mono font-medium">{p.provider}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">{p.type}</span>
                {p.configured && <Check className="ml-auto h-3 w-3 text-green-500" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ExtensionsSettings() {
  const [extensions, setExtensions] = useState<any[]>([])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  useEffect(() => {
    ipcClient.invoke('extensions.list').then((res) => {
      setExtensions(res?.extensions || [])
    })
    ipcClient.invoke('settings.get', { key: 'extensionOverrides' }).then((res) => {
      if (res?.settings?.extensionOverrides) setOverrides(res.settings.extensionOverrides)
    })
  }, [])

  const handleToggle = (ext: any) => {
    const isOn = overrides[ext.id] !== false // default on
    const newVal = !isOn
    setOverrides({ ...overrides, [ext.id]: newVal })
    ipcClient.invoke('extensions.setOverride', { extensionId: ext.id, enabled: newVal })
  }

  const COMPAT_STYLES: Record<string, string> = {
    native: 'bg-green-500/10 text-green-600 dark:text-green-400',
    basic: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    headless: 'bg-muted text-muted-foreground',
    blocked: 'bg-destructive/10 text-destructive',
  }

  const COMPAT_LABELS: Record<string, string> = {
    native: 'Native',
    basic: 'Basic',
    headless: 'Headless',
    blocked: 'Blocked',
  }

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">插件</h3>
      {extensions.length === 0 ? (
        <div className="text-[12px] text-muted-foreground/50 py-4">
          未检测到插件。将 .ts 扩展文件或目录放在 .pi/extensions/ 下即可被检测。
        </div>
      ) : (
        <div className="space-y-2">
          {extensions.map((ext) => {
            const isOn = overrides[ext.id] !== false
            return (
              <div key={`${ext.source}-${ext.id}`} className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{ext.name}</span>
                      <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider', COMPAT_STYLES[ext.compatibility])}>
                        {COMPAT_LABELS[ext.compatibility] || ext.compatibility}
                      </span>
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase',
                        ext.source === 'project' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}>
                        {ext.source === 'project' ? '项目' : '全局'}
                      </span>
                    </div>
                    {ext.description && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground/60 truncate">{ext.description}</div>
                    )}
                    {ext.registeredTools.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ext.registeredTools.map((t: string) => (
                          <span key={t} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {ext.registeredCommands.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ext.registeredCommands.map((c: string) => (
                          <span key={c} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            /{c}
                          </span>
                        ))}
                      </div>
                    )}
                    {ext.adapterId && (
                      <div className="mt-1 text-[10px] text-green-600 dark:text-green-400">
                        适配器: {ext.adapterId}
                      </div>
                    )}
                    {ext.loadError && (
                      <div className="mt-1 text-[10px] text-destructive">{ext.loadError}</div>
                    )}
                  </div>
                  <Toggle on={isOn} onChange={() => handleToggle(ext)} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ResourcesSettings() {
  const [resources, setResources] = useState<any>(null)

  useEffect(() => {
    ipcClient.invoke('resources.list').then(setResources).catch(() => {})
  }, [])

  if (!resources) return <div className="text-[12px] text-muted-foreground">加载中...</div>

  const sections = [
    { label: 'Skills', items: resources.skills, icon: Zap },
    { label: 'Prompts', items: resources.prompts, icon: Wrench },
    { label: 'Extensions', items: resources.extensions, icon: Puzzle },
    { label: 'Themes', items: resources.themes, icon: Palette },
  ]

  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-semibold">资源</h3>
      {sections.map(({ label, items, icon: Icon }) => (
        <div key={label}>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">
            <Icon className="h-3 w-3" />
            {label}
            <span className="tabular-nums text-muted-foreground/40">({items?.length || 0})</span>
          </div>
          {items?.length > 0 ? (
            <div className="space-y-1">
              {items.map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-2.5 py-1.5 text-[12px]">
                  <span className="font-medium">{item.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/40">{item.source}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/40 px-1">暂无</div>
          )}
        </div>
      ))}
    </div>
  )
}

function DiagnosticsSettings() {
  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-3">诊断</h3>
      <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
        <div className="text-muted-foreground">
          <span className="text-green-500">●</span> Worker: 正常运行
        </div>
        <div className="text-muted-foreground">
          <span className="text-muted-foreground/40">●</span> Registry: 未检查
        </div>
        <div className="text-muted-foreground">
          <span className="text-green-500">●</span> Renderer: 正常
        </div>
        <div className="text-muted-foreground">
          <span className="text-muted-foreground/40">●</span> Errors: 无
        </div>
      </div>
    </div>
  )
}
