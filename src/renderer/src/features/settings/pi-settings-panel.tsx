import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, AlertCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'

export type PiSettingsSnapshot = Record<string, unknown>

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
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [infoRes, settingsRes, modelsRes] = await Promise.all([
        ipcClient.invoke('pi.getInfo'),
        ipcClient.invoke('pi.settings.get'),
        ipcClient.invoke('model.list'),
      ])
      setInfo(infoRes)
      if (settingsRes?.error) setLoadError(settingsRes.error)
      setSettings(settingsRes?.settings ?? null)
      setModels((modelsRes?.models || []).filter((m: any) => m.available !== false))
    } catch (e: any) {
      setLoadError(e?.message || '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (p: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await ipcClient.invoke('pi.settings.set', { patch: p })
      if (res?.ok === false) throw new Error(res.error || '保存失败')
      const refreshed = await ipcClient.invoke('pi.settings.get')
      setSettings(refreshed?.settings ?? settings)
      void refreshComposerRunDisplay()
      toast.success('已保存 Pi 配置')
    } catch (e: any) {
      console.error('pi.settings.set failed:', e)
      toast.error(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const modelOptions = useMemo(() => {
    const list = [...models]
    const curP = String(settings?.defaultProvider || '')
    const curM = String(settings?.defaultModel || '')
    if (curP && curM && !list.some((m) => m.provider === curP && m.id === curM)) {
      list.unshift({ provider: curP, id: curM, name: `${curP}/${curM}`, available: true })
    }
    return list.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`))
  }, [models, settings?.defaultProvider, settings?.defaultModel])

  const currentModelKey = settings?.defaultProvider && settings?.defaultModel
    ? `${settings.defaultProvider}/${settings.defaultModel}`
    : ''

  const onModelSelect = (key: string) => {
    const i = key.indexOf('/')
    if (i < 0) return
    void patch({ defaultProvider: key.slice(0, i), defaultModel: key.slice(i + 1) })
  }

  if (!settings && !loadError) {
    return <p className="text-[13px] text-muted-foreground">加载 Pi 配置…</p>
  }

  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Pi 配置</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            写入 <code className="rounded bg-muted px-1 text-[10px]">~/.pi/agent/settings.json</code> 与项目{' '}
            <code className="rounded bg-muted px-1 text-[10px]">.pi/settings.json</code>（经 Worker SettingsManager，与终端 pi 一致）。
          </p>
        </div>
        {saving && <span className="text-[11px] text-amber-600">保存中…</span>}
      </div>

      {loadError && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          {loadError}（请先打开工作区以启动 Worker）
        </div>
      )}

      <Section title="环境与认证">
        <Row label="SDK 版本">
          <span className="font-mono text-[12px] text-muted-foreground">{info?.sdkVersion || '—'}</span>
        </Row>
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
            {String(settings?.sessionDir || '(默认)')}
          </span>
        </Row>
      </Section>

      <Section title="模型与推理">
        <Row label="默认模型" description="新会话默认 provider / model（下拉来自 model.list）">
          <select
            className={cn(selectCls, 'min-w-[min(280px,70vw)]')}
            value={currentModelKey}
            disabled={!settings || modelOptions.length === 0}
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
            value={String(settings?.defaultThinkingLevel || 'medium')}
            disabled={!settings}
            onChange={(e) => void patch({ defaultThinkingLevel: e.target.value })}
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
            disabled={!settings}
            defaultValue={Array.isArray(settings?.enabledModels) ? (settings.enabledModels as string[]).join(', ') : ''}
            placeholder="例如 anthropic/*, openai/gpt-*"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              const patterns = raw ? raw.split(/,\s*/).filter(Boolean) : undefined
              void patch({ enabledModels: patterns })
            }}
          />
        </Row>
        <Row label="隐藏思考块" description="hideThinkingBlock（TUI/展示）">
          <Toggle
            on={!!settings?.hideThinkingBlock}
            disabled={!settings}
            onChange={(v) => void patch({ hideThinkingBlock: v })}
          />
        </Row>
      </Section>

      <Section title="队列与传输">
        <Row label="Steering 模式" description="插入消息排队">
          <select
            className={selectCls}
            value={String(settings?.steeringMode || 'all')}
            disabled={!settings}
            onChange={(e) => void patch({ steeringMode: e.target.value })}
          >
            <option value="all">all — 全部插入</option>
            <option value="one-at-a-time">one-at-a-time</option>
          </select>
        </Row>
        <Row label="Follow-up 模式" description="后续追问排队">
          <select
            className={selectCls}
            value={String(settings?.followUpMode || 'all')}
            disabled={!settings}
            onChange={(e) => void patch({ followUpMode: e.target.value })}
          >
            <option value="all">all</option>
            <option value="one-at-a-time">one-at-a-time</option>
          </select>
        </Row>
        <Row label="Transport" description="LLM 请求传输">
          <select
            className={selectCls}
            value={String(settings?.transport || 'auto')}
            disabled={!settings}
            onChange={(e) => void patch({ transport: e.target.value })}
          >
            <option value="auto">auto</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </Row>
        <Row label="HTTP 空闲超时" description={`httpIdleTimeoutMs（当前 ${settings?.httpIdleTimeoutMs ?? '—'} ms）`}>
          <input
            type="number"
            className={cn(inputCls, 'max-w-[8rem]')}
            disabled={!settings}
            defaultValue={String(settings?.httpIdleTimeoutMs ?? '')}
            min={0}
            step={1000}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 0) void patch({ httpIdleTimeoutMs: n })
            }}
          />
        </Row>
      </Section>

      <Section title="压缩与重试">
        <Row label="自动压缩" description="compaction.enabled">
          <Toggle
            on={settings?.compactionEnabled !== false}
            disabled={!settings}
            onChange={(v) => void patch({ compactionEnabled: v })}
          />
        </Row>
        <Row label="压缩 reserve" description="compaction.reserveTokens，为回复预留的 token（默认 16384）">
          <input
            type="number"
            className={cn(inputCls, 'max-w-[9rem]')}
            disabled={!settings}
            key={`reserve-${settings?.compactionReserveTokens}`}
            defaultValue={String(settings?.compactionReserveTokens ?? 16384)}
            min={0}
            step={512}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n) || n < 0) return
              void patch({ compactionReserveTokens: Math.floor(n) })
            }}
          />
        </Row>
        <Row label="压缩 keep" description="compaction.keepRecentTokens，保留不摘要的最近 token（默认 20000）">
          <input
            type="number"
            className={cn(inputCls, 'max-w-[9rem]')}
            disabled={!settings}
            key={`keep-${settings?.compactionKeepRecentTokens}`}
            defaultValue={String(settings?.compactionKeepRecentTokens ?? 20000)}
            min={0}
            step={512}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n) || n < 0) return
              void patch({ compactionKeepRecentTokens: Math.floor(n) })
            }}
          />
        </Row>
        <Row label="请求重试" description="retry.enabled">
          <Toggle
            on={settings?.retryEnabled !== false}
            disabled={!settings}
            onChange={(v) => void patch({ retryEnabled: v })}
          />
        </Row>
        <Row label="重试参数" description="只读">
          <span className="font-mono text-[11px] text-muted-foreground">
            max {String(settings?.retryMaxRetries)} · delay {String(settings?.retryBaseDelayMs)}ms
          </span>
        </Row>
        <Row label="分支摘要" description="branchSummary（树跳转摘要）">
          <span className="font-mono text-[11px] text-muted-foreground">
            reserve {String(settings?.branchSummaryReserveTokens)} · skipPrompt{' '}
            {settings?.branchSummarySkipPrompt ? '是' : '否'}
          </span>
        </Row>
      </Section>

      <Section title="工具与 Shell">
        <Row label="Shell 路径" description="bash 工具 shellPath">
          <input
            className={inputCls}
            disabled={!settings}
            placeholder="系统默认"
            defaultValue={String(settings?.shellPath || '')}
            onBlur={(e) => void patch({ shellPath: e.target.value || undefined })}
          />
        </Row>
        <Row label="Shell 命令前缀" description="shellCommandPrefix">
          <input
            className={inputCls}
            disabled={!settings}
            defaultValue={String(settings?.shellCommandPrefix || '')}
            onBlur={(e) => void patch({ shellCommandPrefix: e.target.value || undefined })}
          />
        </Row>
        <Row label="npm 命令" description="npmCommand">
          <input
            className={inputCls}
            disabled={!settings}
            defaultValue={String(settings?.npmCommand || '')}
            placeholder="npm"
            onBlur={(e) => void patch({ npmCommand: e.target.value || undefined })}
          />
        </Row>
        <Row label="图片自动缩放" description="imageAutoResize">
          <Toggle
            on={!!settings?.imageAutoResize}
            disabled={!settings}
            onChange={(v) => void patch({ imageAutoResize: v })}
          />
        </Row>
        <Row label="展示图片" description="showImages">
          <Toggle
            on={settings?.showImages !== false}
            disabled={!settings}
            onChange={(v) => void patch({ showImages: v })}
          />
        </Row>
        <Row label="阻止图片" description="blockImages">
          <Toggle
            on={!!settings?.blockImages}
            disabled={!settings}
            onChange={(v) => void patch({ blockImages: v })}
          />
        </Row>
      </Section>

      <Section title="技能与启动">
        <Row label="默认项目信任" description="defaultProjectTrust（打开新项目时）">
          <select
            className={selectCls}
            value={String(settings?.defaultProjectTrust || 'ask')}
            disabled={!settings}
            onChange={(e) => void patch({ defaultProjectTrust: e.target.value })}
          >
            <option value="ask">ask</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
        </Row>
        <Row label="Skill 斜杠命令" description="enableSkillCommands">
          <Toggle
            on={settings?.enableSkillCommands !== false}
            disabled={!settings}
            onChange={(v) => void patch({ enableSkillCommands: v })}
          />
        </Row>
        <Row label="安静启动" description="quietStartup">
          <Toggle on={!!settings?.quietStartup} disabled={!settings} onChange={(v) => void patch({ quietStartup: v })} />
        </Row>
      </Section>
      <p className="pt-2 text-[10px] text-muted-foreground/55">
        会话树：主界面输入框为空时 <strong>双击 Esc</strong> 打开大图（同 TUI /tree）。项目信任请在打开项目后使用 /trust。
      </p>
    </div>
  )
}