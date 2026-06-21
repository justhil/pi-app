import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { ExtensionConfigSubpage } from '@renderer/features/extension-ui/extension-config-subpage'
import { PiSettingsPanel } from '@renderer/features/settings/pi-settings-panel'
import {
  Settings as SettingsIcon, Palette, Cpu, Puzzle, Zap, MessageSquareText,
  Moon, Sun, Monitor, Check, AlertCircle, Folder, Layers, ChevronLeft, LayoutPanelLeft
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
import { SettingsDraftProvider } from '@renderer/features/settings/settings-draft-context'
import { SettingsSaveBar } from '@renderer/features/settings/settings-save-bar'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'

type SettingsPage = 'general' | 'appearance' | 'rightPanels' | 'pi' | 'skills' | 'prompts' | 'extensions' | 'adapters'

const PAGES: { key: SettingsPage; icon: any; label: string }[] = [
  { key: 'general', icon: SettingsIcon, label: '通用' },
  { key: 'appearance', icon: Palette, label: '外观' },
  { key: 'rightPanels', icon: LayoutPanelLeft, label: '右侧栏' },
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
            onClick={() => setConfigExt(null)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回适配器
          </button>
          <span className="text-[13px] font-medium">{configExt} 配置</span>
        </div>
        <SettingsMain wide>
          <div className="animate-in fade-in slide-in-from-right duration-motion-normal">
            <ExtensionConfigSubpage extensionId={configExt} />
          </div>
        </SettingsMain>
      </div>
    )
  }

  const widePages: SettingsPage[] = ['rightPanels', 'pi', 'skills', 'prompts', 'extensions', 'adapters']
  const wide = widePages.includes(page)

  return (
    <SettingsDraftProvider>
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <SettingsNav title={t('settings.title')}>
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
          {page === 'skills' && <SkillsSettingsPanel />}
          {page === 'prompts' && <PromptsSettingsPanel />}
          {page === 'extensions' && <ExtensionsSettings />}
          {page === 'adapters' && <AdaptersSettings />}
        </SettingsMain>
      </div>
    </SettingsDraftProvider>
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
  const {
    draft,
    setAutoOpenLastProject,
    setAutoCheckRegistryUpdates,
    setLanguage,
    setAlertSoundEnabled,
    setAlertNotificationEnabled,
    setAlertOnExtensionUi,
    setAlertOnRunIdle,
  } = useSettingsDraft()
  const [recentProjects, setRecentProjects] = useState<string[]>([])

  useEffect(() => {
    ipcClient.invoke('settings.get', { key: 'recentProjects' }).then((res) => {
      if (res?.settings?.recentProjects) setRecentProjects(res.settings.recentProjects)
    })
  }, [])

  return (
    <div className="space-y-1">
      <SettingsPageHeader title="常规" description="修改后请使用页面底部「保存」写入本机配置。" />
      <SettingRow label="启动时打开上次项目" description="自动恢复上次打开的项目目录">
        <Toggle on={draft.autoOpenLastProject} onChange={setAutoOpenLastProject} />
      </SettingRow>
      <SettingRow label="自动检查更新" description="启动时检查适配器 registry 更新">
        <Toggle on={draft.autoCheckRegistryUpdates} onChange={setAutoCheckRegistryUpdates} />
      </SettingRow>
      <div className="pt-4 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70">提醒</div>
      <SettingRow label="提示音" description="用户提醒时播放短提示音（与下方场景配合）">
        <Toggle on={draft.alertSoundEnabled} onChange={setAlertSoundEnabled} />
      </SettingRow>
      <SettingRow label="系统通知" description="使用操作系统通知中心（通知本身静音，可与提示音叠加）">
        <Toggle on={draft.alertNotificationEnabled} onChange={setAlertNotificationEnabled} />
      </SettingRow>
      <SettingRow
        label="扩展问答弹窗"
        description="兼容层弹窗需你作答/确认时提醒（Agent 会暂停等待）"
      >
        <Toggle on={draft.alertOnExtensionUi} onChange={setAlertOnExtensionUi} />
      </SettingRow>
      <SettingRow label="一轮运行结束" description="Agent 状态变为空闲（本轮 loop 结束）时提醒">
        <Toggle on={draft.alertOnRunIdle} onChange={setAlertOnRunIdle} />
      </SettingRow>
      <SettingRow label="语言" description="界面语言">
        <div className="flex gap-1.5">
          {[
            { key: 'zh' as const, label: '中文' },
            { key: 'en' as const, label: 'English' },
          ].map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLanguage(l.key)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-[12px] transition-all duration-motion-fast ease-motion-ease',
                draft.language === l.key
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
  const { draft, setTheme } = useSettingsDraft()

  const themes: { key: 'light' | 'dark' | 'system'; icon: any }[] = [
    { key: 'light', icon: Sun },
    { key: 'dark', icon: Moon },
    { key: 'system', icon: Monitor },
  ]

  return (
    <div className="space-y-1">
      <SettingsPageHeader title={t('settings.appearance')} description="主题预览即时生效；持久化需点页面底部「保存」。" />
      <SettingRow label="主题" description="选择界面主题">
        <div className="flex gap-1.5">
          {themes.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTheme(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all duration-motion-fast ease-motion-ease',
                draft.theme === key
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
  const { draft, setExtensionOverride } = useSettingsDraft()
  const [extensions, setExtensions] = useState<any[]>([])
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
  }, [])

  const handleToggle = (ext: any) => {
    const isOn = draft.extensionOverrides[ext.id] !== false
    setExtensionOverride(ext.id, !isOn)
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
    <div className="space-y-1 w-full">
      <SettingsPageHeader
        title="插件"
        description={
          '列表含磁盘探测结果；实际可调用工具以当前 Worker 为准。与终端 pi 同源：settings.packages、extensions 路径与 ~/.pi/agent/extensions。'
        }
      />
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
            const isOn = draft.extensionOverrides[ext.id] !== false
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
    <div className="w-full space-y-3">
      <SettingsPageHeader
        title="桌面适配器"
        description="已登记的 adapter.json 兼容层；一插件一适配器，经兼容层接入桌面 UI 与配置。"
      />
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

