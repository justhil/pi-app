import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { ExtensionConfigSubpage } from '@renderer/features/extension-ui/extension-config-subpage'
import {
  Settings as SettingsIcon, Palette, Cpu, Puzzle, Package, Stethoscope,
  Moon, Sun, Monitor, Check, AlertCircle, Folder, Zap, Wrench, Layers, ChevronLeft
} from 'lucide-react'

type SettingsPage = 'general' | 'appearance' | 'pi' | 'extensions' | 'adapters' | 'resources' | 'diagnostics'

const PAGES: { key: SettingsPage; icon: any; labelKey: string }[] = [
  { key: 'general', icon: SettingsIcon, labelKey: 'settings.general' },
  { key: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
  { key: 'pi', icon: Cpu, labelKey: 'settings.pi' },
  { key: 'extensions', icon: Puzzle, labelKey: 'settings.extensions' },
  { key: 'adapters', icon: Layers, labelKey: 'settings.adapters' },
  { key: 'resources', icon: Package, labelKey: 'settings.resources' },
  { key: 'diagnostics', icon: Stethoscope, labelKey: 'settings.diagnostics' },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState<SettingsPage>('general')
  const [configExt, setConfigExt] = useState<string | null>(null)
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

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
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <button
            onClick={() => setConfigExt(null)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回适配器
          </button>
          <span className="text-[13px] font-medium">{configExt} 配置</span>
        </div>
        <div className="flex-1 overflow-y-auto p-6 animate-in fade-in slide-in-from-right">
          <div className="mx-auto max-w-2xl px-2">
            <ExtensionConfigSubpage extensionId={configExt} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-52 shrink-0 border-r border-border/60 bg-surface-sidebar">
        <div className="px-4 py-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
          {t('settings.title')}
        </div>
        {PAGES.map((p) => (
          <button
            key={p.key}
            onClick={() => setPage(p.key)}
            className={cn(
              'flex w-full items-center gap-2.5 px-4 py-2 text-[13px] transition-all duration-motion-fast ease-motion-ease',
              page === p.key
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            )}
          >
            <p.icon className="h-4 w-4 shrink-0" />
            {t(p.labelKey)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">
          {page === 'general' && <GeneralSettings />}
          {page === 'appearance' && <AppearanceSettings />}
          {page === 'pi' && <PiSettings />}
          {page === 'extensions' && <ExtensionsSettings />}
          {page === 'adapters' && <AdaptersSettings />}
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
    useUIStore.getState().setTheme(newTheme)  // mirror to persisted ui-store for anti-FOUC
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
  const [settings, setSettings] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ipcClient.invoke('pi.getInfo').then(setInfo).catch(() => {})
    ipcClient.invoke('pi.settings.get').then((res) => setSettings(res?.settings || null)).catch(() => {})
  }, [])

  const patch = async (p: Record<string, unknown>) => {
    setSaving(true)
    try {
      await ipcClient.invoke('pi.settings.set', { patch: p })
      const res = await ipcClient.invoke('pi.settings.get')
      setSettings(res?.settings || settings)
    } catch (e) {
      console.error('pi.settings.set failed:', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-1">Pi 配置</h3>
      <p className="text-[11px] text-muted-foreground/70 mb-3">
        改动写回 <code className="bg-muted px-1 rounded text-[10px]">~/.pi/agent/settings.json</code> 或项目级 .pi/settings.json，经 Worker SettingsManager，与终端 pi 一致。
      </p>

      <SettingRow label="SDK 版本" description="内置 pi-coding-agent 版本">
        <span className="text-[13px] font-mono text-muted-foreground">{info?.sdkVersion || '...'}</span>
      </SettingRow>
      <SettingRow label="agentDir" description="pi 配置目录">
        <span className="text-[12px] font-mono text-muted-foreground">{info?.agentDir || '~/.pi/agent'}</span>
      </SettingRow>
      <SettingRow label="认证状态" description="API key / OAuth / 订阅">
        <div className="flex items-center gap-1.5">
          {info?.authStatus === 'configured' ? (
            <><Check className="h-3.5 w-3.5 text-green-500" /><span className="text-[12px] text-green-600 dark:text-green-400">已配置</span></>
          ) : (
            <><AlertCircle className="h-3.5 w-3.5 text-muted-foreground/40" /><span className="text-[12px] text-muted-foreground">未配置</span></>
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

      <div className="pt-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">
          默认模型 {saving && <span className="text-amber-500 normal-case">保存中…</span>}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono"
            placeholder="provider"
            defaultValue={settings?.defaultProvider || ''}
            onBlur={(e) => e.target.value !== (settings?.defaultProvider || '') && patch({ defaultProvider: e.target.value })}
          />
          <input
            className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono"
            placeholder="modelId"
            defaultValue={settings?.defaultModel || ''}
            onBlur={(e) => e.target.value !== (settings?.defaultModel || '') && patch({ defaultModel: e.target.value })}
          />
        </div>
      </div>

      <SettingRow label="默认 Thinking" description="新会话默认 thinking 等级">
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
          value={settings?.defaultThinkingLevel || 'medium'}
          onChange={(e) => patch({ defaultThinkingLevel: e.target.value })}
        >
          {['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((lv) => <option key={lv} value={lv}>{lv}</option>)}
        </select>
      </SettingRow>

      <SettingRow label="自动压缩" description="上下文超阈时自动压缩历史">
        <Toggle on={!!settings?.compactionEnabled} onChange={(v) => patch({ compactionEnabled: v })} />
      </SettingRow>

      <SettingRow label="Steering 模式" description="插入消息时的排队方式">
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
          value={settings?.steeringMode || 'all'}
          onChange={(e) => patch({ steeringMode: e.target.value })}
        >
          <option value="all">all</option>
          <option value="one-at-a-time">one-at-a-time</option>
        </select>
      </SettingRow>

      <SettingRow label="FollowUp 模式" description="后续追问排队方式">
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
          value={settings?.followUpMode || 'all'}
          onChange={(e) => patch({ followUpMode: e.target.value })}
        >
          <option value="all">all</option>
          <option value="one-at-a-time">one-at-a-time</option>
        </select>
      </SettingRow>

      <SettingRow label="传输方式" description="provider transport (sse / http / auto)">
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
          value={settings?.transport || 'auto'}
          onChange={(e) => patch({ transport: e.target.value })}
        >
          <option value="auto">auto</option>
          <option value="sse">sse</option>
          <option value="http">http</option>
        </select>
      </SettingRow>

      <SettingRow label="Shell 路径" description="bash 工具使用的 shell（留空用默认）">
        <input
          className="w-40 rounded-md border border-border bg-background px-2 py-1 text-[12px] font-mono"
          placeholder="默认"
          defaultValue={settings?.shellPath || ''}
          onBlur={(e) => e.target.value !== (settings?.shellPath || '') && patch({ shellPath: e.target.value || undefined })}
        />
      </SettingRow>

      <SettingRow label="图片自动缩放" description="read 工具读取图片时自动缩放">
        <Toggle on={!!settings?.imageAutoResize} onChange={(v) => patch({ imageAutoResize: v })} />
      </SettingRow>

      <div className="pt-2 text-[10px] text-muted-foreground/50">
        sessionDir: <span className="font-mono">{settings?.sessionDir || '(默认)'}</span>
      </div>
    </div>
  )
}

function ExtensionsSettings() {
  const [extensions, setExtensions] = useState<any[]>([])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [runtimeTools, setRuntimeTools] = useState<any[]>([])

  useEffect(() => {
    ipcClient.invoke('extensions.list').then((res) => {
      setExtensions(res?.extensions || [])
    })
    ipcClient.invoke('settings.get', { key: 'extensionOverrides' }).then((res) => {
      if (res?.settings?.extensionOverrides) setOverrides(res.settings.extensionOverrides)
    })
    ipcClient.invoke('runtime.getState').then((res) => {
      setRuntimeTools(Array.isArray(res?.state?.tools) ? res.state.tools : [])
    }).catch(() => setRuntimeTools([]))
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

  const runtimeNames = new Set(runtimeTools.map((t) => t.name))
  const watchedTools = ['fast_context_search', 'search', 'search_sources', 'ffgrep', 'fffind']

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-1">插件</h3>
      <p className="text-[11px] text-muted-foreground/60 mb-3">
        已安装的 pi 扩展包。静态探测显示包/源码；下方「当前 Worker 工具」才代表本会话实际可调用工具。
      </p>
      <div className="mb-3 rounded-lg border border-border/50 bg-muted/20 p-2.5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          当前 Worker 工具 {runtimeTools.length ? `(${runtimeTools.length})` : '(Worker 未启动或无会话)'}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {watchedTools.map((name) => (
            <span
              key={name}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                runtimeNames.has(name) ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground/45',
              )}
            >
              {runtimeNames.has(name) ? '✓ ' : '· '}{name}
            </span>
          ))}
        </div>
      </div>
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
                    {ext.adapterId ? (
                      <div className="mt-1 text-[10px] text-green-700 dark:text-green-400">
                        桌面适配器：<span className="font-medium">{ext.adapterId}</span>
                      </div>
                    ) : ext.tuiOnly ? (
                      <div className="mt-1 text-[10px] text-muted-foreground/70 italic">
                        仅终端生效（TUI 装饰，桌面不复刻）
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-muted-foreground/55 italic">
                        未登记桌面适配（无专属桌面实现，工具/命令仍可在会话中加载）
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

const TIER_STYLES: Record<string, string> = {
  native: 'bg-green-500/10 text-green-700 dark:text-green-400',
  partial: 'bg-amber-500/10 text-amber-800 dark:text-amber-400',
  headless: 'bg-muted text-muted-foreground',
  none: 'bg-muted text-muted-foreground',
}

const TIER_LABELS: Record<string, string> = {
  native: '完整',
  partial: '部分',
  headless: '仅执行',
  none: '无',
}

function AdaptersSettings() {
  const [adapters, setAdapters] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

  useEffect(() => {
    setError(null)
    // v2-only catalog: adapters.catalog already merges probed plugins with v2 adapter.json + orphans.
    ipcClient
      .invoke('adapters.catalog')
      .then((res) => {
        setAdapters(Array.isArray(res?.adapters) ? res.adapters : [])
      })
      .catch((e) => {
        setAdapters([])
        setError(String(e))
      })
  }, [])

  if (adapters === null) {
    return <div className="text-[12px] text-muted-foreground/50 py-4">加载中…</div>
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <h3 className="text-[15px] font-semibold">桌面适配器</h3>
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        列出已登记的桌面适配器（<code className="text-[10px] bg-muted px-1 rounded">adapter.json</code> 声明式兼容层）。
        <strong>一插件一适配器</strong>，名称与包名相同；所有插件均经兼容层接入。
      </p>
      {error && <div className="text-[11px] text-destructive">{error}</div>}
      {adapters.length === 0 ? (
        <div className="text-[12px] text-muted-foreground/50 py-4">
          当前没有已登记的桌面适配器。插件仍可在「插件」页看到；要接入新插件请在兼容层声明 adapter.json。
        </div>
      ) : (
        <div className="space-y-3">
          {adapters.map((a) => (
            <div key={a.pluginId} className="rounded-lg border border-border/60 bg-card/40 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-medium">{a.displayName}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', TIER_STYLES[a.tier])}>
                  {TIER_LABELS[a.tier] || a.tier}
                </span>
                <span className="text-[10px] text-muted-foreground">{a.source}</span>
                {a.version && <span className="text-[10px] font-mono text-muted-foreground">v{a.version}</span>}
                {a.adapterVersion && (
                  <span className="text-[10px] text-muted-foreground">适配器 v{a.adapterVersion}</span>
                )}
              </div>
              {a.description && <p className="mt-1 text-[12px] text-muted-foreground/80">{a.description}</p>}
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">桌面：</span>
                {a.desktopSupport}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground/60 font-mono">
                probe: {a.matchMeta?.probeId}
                {a.matchMeta?.npmPackage ? ` · npm: ${a.matchMeta.npmPackage}` : ''}
              </div>
              {a.registeredTools?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.registeredTools.map((t: string) => (
                    <span key={t} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">{t}</span>
                  ))}
                </div>
              )}
              {a.tier !== 'none' && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => requestExtensionConfig(a.id)}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-accent"
                  >
                    打开配置
                  </button>
                </div>
              )}
            </div>
          ))}
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
