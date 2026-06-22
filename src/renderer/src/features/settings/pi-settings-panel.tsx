import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, AlertCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'

export type PiSettingsSnapshot = Record<string, unknown>

function settingsEqual(a: PiSettingsSnapshot | null, b: PiSettingsSnapshot | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pt-5 first:pt-0">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{title}</div>
      <div className="rounded-lg border border-border/50 bg-card/20 px-3">{children}</div>
    </div>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 border-b border-border/40 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-[11px] text-muted-foreground/65">{description}</div>}
      </div>
      <div className="shrink-0 sm:ml-4">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors duration-motion-fast',
        on ? 'bg-primary' : 'bg-muted-foreground/20',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

const selectCls = 'max-w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] min-w-[10rem]'
const inputCls = 'w-full max-w-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono'
const btnPrimary = 'rounded-md bg-primary px-2.5 py-1.5 text-[12px] text-primary-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none'
const btnOutline = 'rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-40 disabled:pointer-events-none hover:bg-accent'

const THINKING_OPTS = [
  { v: 'off', l: '关' },
  { v: 'minimal', l: '极简' },
  { v: 'low', l: '低' },
  { v: 'medium', l: '中' },
  { v: 'high', l: '高' },
  { v: 'xhigh', l: '极高' },
]

export function PiSettingsPanel() {
  const [info, setInfo] = useState<any>(null)
  const [settings, setSettings] = useState<PiSettingsSnapshot | null>(null)
  const [models, setModels] = useState<any[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<PiSettingsSnapshot | null>(null)
  const [draft, setDraft] = useState<PiSettingsSnapshot | null>(null)
  const [formEpoch, setFormEpoch] = useState(0)

  // SDK 升级 / 切换 / 回退
  const [sdkStatus, setSdkStatus] = useState<any>(null)
  const [registry, setRegistry] = useState<{ versions: string[]; latest: string | null } | null>(null)
  const [selectedVersion, setSelectedVersion] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installOutput, setInstallOutput] = useState<string[]>([])
  const [switching, setSwitching] = useState(false)
  const [envTarget, setEnvTarget] = useState<'builtin' | 'global' | 'user'>('builtin')

  const currentWorkspace = useUIStore((s) => s.currentWorkspace)

  const loadModelsForDropdown = useCallback(async () => {
    try {
      const modelsRes = await ipcClient.invoke('model.list', { scope: 'catalog' })
      setModels((modelsRes?.models || []).filter((m: any) => m.available !== false))
    } catch {
      setModels([])
    }
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [infoRes, settingsRes] = await Promise.all([
        ipcClient.invoke('pi.getInfo'),
        ipcClient.invoke('pi.settings.get'),
      ])
      setInfo(infoRes)
      if (settingsRes?.error) setLoadError(settingsRes.error)
      const snap = settingsRes?.settings ?? null
      setSettings(snap)
      setBaseline(snap)
      setDraft(snap ? { ...snap } : null)
      setFormEpoch((n) => n + 1)
      await loadModelsForDropdown()
    } catch (e: any) {
      setLoadError(e?.message || '加载失败')
    }
  }, [loadModelsForDropdown])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadModelsForDropdown()
  }, [currentWorkspace, loadModelsForDropdown])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadModelsForDropdown()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [loadModelsForDropdown])

  const reloadSdk = useCallback(async () => {
    try {
      const [status, avail] = await Promise.all([
        ipcClient.invoke('sdk.status'),
        ipcClient.invoke('sdk.listAvailable'),
      ])
      setSdkStatus(status)
      setRegistry(avail)
      setEnvTarget(status?.active?.kind || 'builtin')
      setSelectedVersion((cur) => cur || (avail?.latest ?? ''))
    } catch (e) {
      console.error('sdk status load failed', e)
    }
  }, [])

  useEffect(() => { void reloadSdk() }, [reloadSdk])

  // 订阅 SDK 安装进度事件
  useEffect(() => {
    return onAppEvent((event) => {
      if (event.type !== 'sdk-install-progress') return
      if (event.line) setInstallOutput((prev) => [...prev, event.line!])
      if (event.done) {
        setInstalling(false)
        if (event.error) toast.error(`升级失败: ${event.error}`)
        else toast.success('SDK 升级完成，已切换到独立环境')
        void reloadSdk()
      }
    })
  }, [reloadSdk])

  const onInstall = useCallback(async () => {
    if (!selectedVersion) return
    setInstalling(true)
    setInstallOutput([])
    try {
      const res = await ipcClient.invoke('sdk.install', { version: selectedVersion })
      if (res?.ok === false) {
        setInstalling(false)
        toast.error(res.error || '升级失败')
      }
    } catch (e: any) {
      setInstalling(false)
      toast.error(e?.message || '升级失败')
    }
  }, [selectedVersion])

  const onSwitchEnv = useCallback(async (target: 'builtin' | 'global' | 'user') => {
    setSwitching(true)
    try {
      const res = await ipcClient.invoke('sdk.switch', { target })
      if (res?.ok === false) {
        toast.error(res.error || '切换失败')
        return
      }
      const label = target === 'builtin' ? '内置版本' : target === 'global' ? '全局版本' : '独立环境'
      toast.success(`已切换到${label}`)
      void reloadSdk()
    } catch (e: any) {
      toast.error(e?.message || '切换失败')
    } finally {
      setSwitching(false)
    }
  }, [reloadSdk])

  const queuePatch = useCallback((p: Record<string, unknown>) => {
    setDraft((prev) => ({ ...(prev || {}), ...p }))
    notifySettingsDirtyChanged()
  }, [])

  const reloadPiForm = useCallback(async () => {
    const settingsRes = await ipcClient.invoke('pi.settings.get')
    const snap = settingsRes?.settings ?? null
    setSettings(snap)
    setBaseline(snap)
    setDraft(snap ? { ...snap } : null)
    setFormEpoch((n) => n + 1)
  }, [])

  useSettingsDirtySlice({
    id: 'pi',
    label: 'Pi 配置',
    isDirty: () => !settingsEqual(draft, baseline),
    commit: async () => {
      if (!draft || settingsEqual(draft, baseline)) return
      const res = await ipcClient.invoke('pi.settings.set', { patch: draft })
      if (res?.ok === false) throw new Error(res.error || '保存失败')
      await reloadPiForm()
      void refreshComposerRunDisplay()
    },
    discard: () => {
      void reloadPiForm()
    },
  })

  const ui = draft ?? settings

  const modelOptions = useMemo(() => {
    const list = [...models]
    const curP = String(ui?.defaultProvider || '')
    const curM = String(ui?.defaultModel || '')
    if (curP && curM && !list.some((m) => m.provider === curP && m.id === curM)) {
      list.unshift({ provider: curP, id: curM, name: `${curP}/${curM}`, available: true })
    }
    return list.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`))
  }, [models, ui?.defaultProvider, ui?.defaultModel])

  const currentModelKey = ui?.defaultProvider && ui?.defaultModel
    ? `${ui.defaultProvider}/${ui.defaultModel}`
    : ''

  const onModelSelect = (key: string) => {
    const i = key.indexOf('/')
    if (i < 0) return
    queuePatch({ defaultProvider: key.slice(0, i), defaultModel: key.slice(i + 1) })
  }

  if (!ui && !loadError) {
    return <p className="text-[13px] text-muted-foreground">加载 Pi 配置…</p>
  }

  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Pi 配置</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            写入 <code className="rounded bg-muted px-1 text-[10px]">~/.pi/agent/settings.json</code> 与项目{' '}
            <code className="rounded bg-muted px-1 text-[10px]">.pi/settings.json</code>（经 Worker SettingsManager，与终端 pi 一致）。修改后请用页面底部「保存」。
          </p>
        </div>
      </div>

      {loadError && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          {loadError}（请先打开工作区以启动 Worker）
        </div>
      )}

      <Section title="环境与认证">
        {/* SDK 版本管理 */}
        <div className="py-3 border-b border-border/40">
          <div className="mb-2 text-[13px] font-medium text-foreground">SDK 版本管理</div>
          <div className="grid grid-cols-1 gap-1.5 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">内置版本</span>
              <span className="font-mono text-muted-foreground">{sdkStatus?.builtinVersion || info?.sdkVersion || '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">全局版本</span>
              <span className="font-mono text-muted-foreground">{sdkStatus?.globalVersion || '未检测到'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">独立环境</span>
              <span className="font-mono text-muted-foreground">{sdkStatus?.userVersion || '未安装'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">当前生效</span>
              <span className="font-mono text-foreground">
                {sdkStatus?.active?.version || '—'} ({sdkStatus?.active?.kind === 'global' ? '全局' : sdkStatus?.active?.kind === 'user' ? '独立环境' : '内置'})
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">registry 最新</span>
              <span className="font-mono text-muted-foreground">{registry?.latest || (registry ? '—' : '加载中…')}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">npm</span>
              <span className="font-mono text-muted-foreground">
                {sdkStatus?.npmAvailable ? '可用 ✓' : '未检测到 ✗（升级需本机 npm）'}
              </span>
            </div>
          </div>
          {sdkStatus?.active?.fallbackReason && (
            <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              {sdkStatus.active.kind === 'user' ? '独立环境' : '全局版本'}不可用，已回退内置
            </div>
          )}
          {sdkStatus?.workerFallback && (
            <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              目标 SDK 加载失败，已回退内置
            </div>
          )}
          {/* 切换生效环境 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground/70">切换生效环境</span>
            <select
              className={cn(selectCls, 'min-w-[8rem]')}
              value={envTarget}
              disabled={switching || installing}
              onChange={(e) => setEnvTarget(e.target.value as 'builtin' | 'global' | 'user')}
            >
              <option value="builtin">内置</option>
              <option value="global" disabled={!sdkStatus?.globalVersion}>全局{!sdkStatus?.globalVersion ? '（未检测到）' : ''}</option>
              <option value="user" disabled={!sdkStatus?.userVersion}>独立环境{!sdkStatus?.userVersion ? '（未安装）' : ''}</option>
            </select>
            <button
              type="button"
              className={btnOutline}
              disabled={switching || installing || envTarget === sdkStatus?.active?.kind || (envTarget === 'global' && !sdkStatus?.globalVersion) || (envTarget === 'user' && !sdkStatus?.userVersion)}
              onClick={() => onSwitchEnv(envTarget)}
            >
              {switching ? '切换中…' : '切换'}
            </button>
          </div>
          {/* 升级独立环境（覆盖式安装） */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground/70">升级独立环境</span>
            <select
              className={cn(selectCls, 'min-w-[8rem]')}
              value={selectedVersion}
              disabled={installing || !sdkStatus?.npmAvailable}
              onChange={(e) => setSelectedVersion(e.target.value)}
            >
              <option value="">选择版本…</option>
              {(registry?.versions || []).slice().reverse().map((v) => (
                <option key={v} value={v}>
                  {v}{v === registry?.latest ? ' (latest)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={btnPrimary}
              disabled={installing || !selectedVersion || !sdkStatus?.npmAvailable}
              onClick={onInstall}
            >
              {installing ? '安装中…' : '升级并切换'}
            </button>
          </div>
          {(installing || installOutput.length > 0) && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/50 p-2 text-[10px] font-mono whitespace-pre-wrap text-muted-foreground">
              {installOutput.join('\n')}{installing ? '\n…' : ''}
            </pre>
          )}
        </div>
        <Row label="agentDir" description="全局 pi 配置目录">
          <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground" title={info?.agentDir}>
            {info?.agentDir || '~/.pi/agent'}
          </span>
        </Row>
        <Row label="认证" description="API key / OAuth">
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
        </Row>
        {info?.authProviders?.length > 0 && (
          <Row label="Provider" description="已配置的鉴权来源">
            <div className="flex max-w-xs flex-wrap justify-end gap-1">
              {info.authProviders.map((p: any) => (
                <span key={p.provider} className="rounded border border-border/50 px-1.5 py-0.5 font-mono text-[10px]">
                  {p.provider}
                </span>
              ))}
            </div>
          </Row>
        )}
        <Row label="会话目录" description="sessionDir（只读）">
          <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
            {String(ui?.sessionDir || '(默认)')}
          </span>
        </Row>
      </Section>

      <Section title="模型与推理">
        <Row label="默认模型" description="新会话默认 provider / model（来自 ~/.pi/agent/models.json，与当前项目无关）">
          <select
            className={cn(selectCls, 'min-w-[min(280px,70vw)]')}
            value={currentModelKey}
            disabled={!ui || modelOptions.length === 0}
            onChange={(e) => onModelSelect(e.target.value)}
          >
            <option value="">未设置</option>
            {modelOptions.map((m) => {
              const key = `${m.provider}/${m.id}`
              const label = m.name && m.name !== m.id ? `${key} — ${m.name}` : key
              return (
                <option key={key} value={key}>
                  {label}
                </option>
              )
            })}
          </select>
        </Row>
        <Row label="默认 Thinking" description="defaultThinkingLevel">
          <select
            className={selectCls}
            value={String(ui?.defaultThinkingLevel || 'medium')}
            disabled={!ui}
            onChange={(e) => queuePatch({ defaultThinkingLevel: e.target.value })}
          >
            {THINKING_OPTS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l} ({o.v})
              </option>
            ))}
          </select>
        </Row>
        <Row label="模型白名单" description="enabledModels，逗号分隔 glob（留空=全部）">
          <input
            className={inputCls}
            disabled={!ui}
            key={`enabledModels-${formEpoch}`}
            defaultValue={Array.isArray(ui?.enabledModels) ? (ui.enabledModels as string[]).join(', ') : ''}
            placeholder="例如 anthropic/*, openai/gpt-*"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              const patterns = raw ? raw.split(/,\s*/).filter(Boolean) : undefined
              queuePatch({ enabledModels: patterns })
            }}
          />
        </Row>
        <Row label="隐藏思考块" description="hideThinkingBlock（TUI/展示）">
          <Toggle
            on={!!ui?.hideThinkingBlock}
            disabled={!ui}
            onChange={(v) => queuePatch({ hideThinkingBlock: v })}
          />
        </Row>
      </Section>

      <Section title="队列与传输">
        <Row label="Steering 模式" description="插入消息排队">
          <select
            className={selectCls}
            value={String(ui?.steeringMode || 'all')}
            disabled={!ui}
            onChange={(e) => queuePatch({ steeringMode: e.target.value })}
          >
            <option value="all">all — 全部插入</option>
            <option value="one-at-a-time">one-at-a-time</option>
          </select>
        </Row>
        <Row label="Follow-up 模式" description="后续追问排队">
          <select
            className={selectCls}
            value={String(ui?.followUpMode || 'all')}
            disabled={!ui}
            onChange={(e) => queuePatch({ followUpMode: e.target.value })}
          >
            <option value="all">all</option>
            <option value="one-at-a-time">one-at-a-time</option>
          </select>
        </Row>
        <Row label="Transport" description="LLM 请求传输">
          <select
            className={selectCls}
            value={String(ui?.transport || 'auto')}
            disabled={!ui}
            onChange={(e) => queuePatch({ transport: e.target.value })}
          >
            <option value="auto">auto</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </Row>
        <Row label="HTTP 空闲超时" description={`httpIdleTimeoutMs（当前 ${ui?.httpIdleTimeoutMs ?? '—'} ms）`}>
          <input
            type="number"
            className={cn(inputCls, 'max-w-[8rem]')}
            disabled={!ui}
            key={`httpIdle-${formEpoch}`}
            defaultValue={String(ui?.httpIdleTimeoutMs ?? '')}
            min={0}
            step={1000}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 0) queuePatch({ httpIdleTimeoutMs: n })
            }}
          />
        </Row>
      </Section>

      <Section title="压缩与重试">
        <Row label="自动压缩" description="compaction.enabled">
          <Toggle
            on={ui?.compactionEnabled !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ compactionEnabled: v })}
          />
        </Row>
        <Row label="压缩 reserve" description="compaction.reserveTokens，为回复预留的 token（默认 16384）">
          <input
            type="number"
            className={cn(inputCls, 'max-w-[9rem]')}
            disabled={!ui}
            key={`reserve-${formEpoch}-${ui?.compactionReserveTokens}`}
            defaultValue={String(ui?.compactionReserveTokens ?? 16384)}
            min={0}
            step={512}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n) || n < 0) return
              queuePatch({ compactionReserveTokens: Math.floor(n) })
            }}
          />
        </Row>
        <Row label="压缩 keep" description="compaction.keepRecentTokens，保留不摘要的最近 token（默认 20000）">
          <input
            type="number"
            className={cn(inputCls, 'max-w-[9rem]')}
            disabled={!ui}
            key={`keep-${formEpoch}-${ui?.compactionKeepRecentTokens}`}
            defaultValue={String(ui?.compactionKeepRecentTokens ?? 20000)}
            min={0}
            step={512}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n) || n < 0) return
              queuePatch({ compactionKeepRecentTokens: Math.floor(n) })
            }}
          />
        </Row>
        <Row label="请求重试" description="retry.enabled">
          <Toggle
            on={ui?.retryEnabled !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ retryEnabled: v })}
          />
        </Row>
        <Row label="重试参数" description="只读">
          <span className="font-mono text-[11px] text-muted-foreground">
            max {String(ui?.retryMaxRetries)} · delay {String(ui?.retryBaseDelayMs)}ms
          </span>
        </Row>
        <Row label="分支摘要" description="branchSummary（树跳转摘要）">
          <span className="font-mono text-[11px] text-muted-foreground">
            reserve {String(ui?.branchSummaryReserveTokens)} · skipPrompt{' '}
            {ui?.branchSummarySkipPrompt ? '是' : '否'}
          </span>
        </Row>
      </Section>

      <Section title="工具与 Shell">
        <Row label="Shell 路径" description="bash 工具 shellPath">
          <input
            className={inputCls}
            disabled={!ui}
            key={`shellPath-${formEpoch}`}
            placeholder="系统默认"
            defaultValue={String(ui?.shellPath || '')}
            onBlur={(e) => queuePatch({ shellPath: e.target.value || undefined })}
          />
        </Row>
        <Row label="Shell 命令前缀" description="shellCommandPrefix">
          <input
            className={inputCls}
            disabled={!ui}
            key={`shellPrefix-${formEpoch}`}
            defaultValue={String(ui?.shellCommandPrefix || '')}
            onBlur={(e) => queuePatch({ shellCommandPrefix: e.target.value || undefined })}
          />
        </Row>
        <Row label="npm 命令" description="npmCommand">
          <input
            className={inputCls}
            disabled={!ui}
            key={`npm-${formEpoch}`}
            defaultValue={String(ui?.npmCommand || '')}
            placeholder="npm"
            onBlur={(e) => queuePatch({ npmCommand: e.target.value || undefined })}
          />
        </Row>
        <Row label="图片自动缩放" description="imageAutoResize">
          <Toggle
            on={!!ui?.imageAutoResize}
            disabled={!ui}
            onChange={(v) => queuePatch({ imageAutoResize: v })}
          />
        </Row>
        <Row label="展示图片" description="showImages">
          <Toggle
            on={ui?.showImages !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ showImages: v })}
          />
        </Row>
        <Row label="阻止图片" description="blockImages">
          <Toggle
            on={!!ui?.blockImages}
            disabled={!ui}
            onChange={(v) => queuePatch({ blockImages: v })}
          />
        </Row>
      </Section>

      <Section title="技能与启动">
        <Row label="默认项目信任" description="defaultProjectTrust（打开新项目时）">
          <select
            className={selectCls}
            value={String(ui?.defaultProjectTrust || 'ask')}
            disabled={!ui}
            onChange={(e) => queuePatch({ defaultProjectTrust: e.target.value })}
          >
            <option value="ask">ask</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
        </Row>
        <Row label="Skill 斜杠命令" description="enableSkillCommands">
          <Toggle
            on={ui?.enableSkillCommands !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ enableSkillCommands: v })}
          />
        </Row>
        <Row label="安静启动" description="quietStartup">
          <Toggle on={!!ui?.quietStartup} disabled={!ui} onChange={(v) => queuePatch({ quietStartup: v })} />
        </Row>
      </Section>
      <p className="pt-2 text-[10px] text-muted-foreground/55">
        会话树：主界面输入框为空时 <strong>双击 Esc</strong> 打开大图（同 TUI /tree）。项目信任请在打开项目后使用 /trust。
      </p>
    </div>
  )
}