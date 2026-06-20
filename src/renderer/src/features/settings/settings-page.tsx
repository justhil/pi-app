import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { ExtensionConfigSubpage } from '@renderer/features/extension-ui/extension-config-subpage'
import { PiSettingsPanel } from '@renderer/features/settings/pi-settings-panel'
import {
  Settings as SettingsIcon, Palette, Cpu, Puzzle, Zap, MessageSquareText,
  Moon, Sun, Monitor, Check, AlertCircle, Folder, Layers, ChevronLeft
} from 'lucide-react'
import { SkillsSettingsPanel } from '@renderer/features/settings/skills-settings-panel'
import { PromptsSettingsPanel } from '@renderer/features/settings/prompts-settings-panel'

type SettingsPage = 'general' | 'appearance' | 'pi' | 'skills' | 'prompts' | 'extensions' | 'adapters'

const PAGES: { key: SettingsPage; icon: any; label: string }[] = [
  { key: 'general', icon: SettingsIcon, label: '通用' },
  { key: 'appearance', icon: Palette, label: '外观' },
  { key: 'pi', icon: Cpu, label: 'Pi' },
  { key: 'skills', icon: Zap, label: 'Skills' },
  { key: 'prompts', icon: MessageSquareText, label: '提示词' },
  { key: 'extensions', icon: Puzzle, label: '扩展' },
  { key: 'adapters', icon: Layers, label: '适配器' },
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
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div
          className={cn(
            'mx-auto px-8 py-8',
            page === 'prompts' ? 'max-w-5xl' : 'max-w-2xl',
          )}
        >
          {page === 'general' && <GeneralSettings />}
          {page === 'appearance' && <AppearanceSettings />}
          {page === 'pi' && <PiSettings />}
          {page === 'skills' && <SkillsSettingsPanel />}
          {page === 'prompts' && <PromptsSettingsPanel />}
          {page === 'extensions' && <ExtensionsSettings />}
          {page === 'adapters' && <AdaptersSettings />}
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
  return <PiSettingsPanel />
}

function ExtensionsSettings() {
  const [extensions, setExtensions] = useState<any[]>([])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [runtimeTools, setRuntimeTools] = useState<any[]>([])
  const [missingRuntime, setMissingRuntime] = useState<any[]>([])
  const [syncing, setSyncing] = useState(false)

  const refreshExtensions = () => {
    ipcClient.invoke('extensions.list').then((res) => {
      setExtensions(res?.extensions || [])
    })
    ipcClient.invoke('extensions.missingRuntimePackages').then((res) => {
      setMissingRuntime(res?.missing || [])
    })
    ipcClient.invoke('runtime.getState').then((res) => {
      setRuntimeTools(Array.isArray(res?.state?.tools) ? res.state.tools : [])
    }).catch(() => setRuntimeTools([]))
  }

  useEffect(() => {
    refreshExtensions()
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

  const runtimeNames = new Set(runtimeTools.map((t) => t.name))
  const watchedTools = ['fast_context_search', 'search', 'search_sources', 'ffgrep', 'fffind']

  return (
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold mb-1">插件</h3>
      <p className="text-[11px] text-muted-foreground/60 mb-3">
        列表含本应用对磁盘的<strong className="font-medium text-foreground-secondary">额外探测</strong>（含未进 packages 的 git 克隆），不等于已加载。<strong className="font-medium text-foreground-secondary">终端 pi TUI 与桌面 Worker 同源</strong>：都走 SDK 的 DefaultResourceLoader——<code className="text-[10px]">settings.packages</code>、<code className="text-[10px]">settings.extensions</code>、<code className="text-[10px]">~/.pi/agent/extensions/</code>、项目 <code className="text-[10px]">.pi/extensions/</code>；<strong className="font-medium text-foreground-secondary">不会</strong>仅因 <code className="text-[10px]">~/.pi/agent/git/…</code> 里有目录就加载。下方「当前 Worker 工具」才是本会话可调用工具。
      </p>
      {missingRuntime.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/8 p-3">
          <div className="text-[12px] font-medium text-amber-800 dark:text-amber-200">未进 Worker 的扩展</div>
          <p className="mt-1 text-[11px] text-foreground-secondary leading-relaxed">
            本机已有 git 克隆，但未列入 settings.packages（终端可能用别的方式加载，桌面不会）。
          </p>
          <ul className="mt-2 space-y-1 text-[11px] font-mono text-foreground-secondary">
            {missingRuntime.map((m: any) => (
              <li key={m.entry}>· {m.repoFolder} → {m.entry}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={syncing}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground disabled:opacity-50"
            onClick={() => {
              setSyncing(true)
              ipcClient.invoke('extensions.syncGitPackages').then((r) => {
                if (r?.added?.length) toast.success(`已写入 packages 并重启 Worker：${r.added.join(', ')}`)
                else if (r?.error) toast.error(r.error)
                refreshExtensions()
              }).catch(() => toast.error('同步失败')).finally(() => setSyncing(false))
            }}
          >
            {syncing ? '同步中…' : '写入 settings.packages 并重启 Worker'}
          </button>
        </div>
      )}
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
                    {ext.inSettingsPackages === false && ext.workerLoadHint && (
                      <div className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-900 dark:text-amber-200">
                        {ext.workerLoadHint}
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

