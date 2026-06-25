import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Check, AlertCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { Switch } from '@renderer/components/ui/switch'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { applyPiDefaultModelToWorkerSession } from '@renderer/lib/sync-session-model'
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
  return <Switch checked={on} onCheckedChange={onChange} disabled={disabled} />
}

const selectCls = 'max-w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] min-w-[10rem]'
const inputCls = 'w-full max-w-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono'
const btnPrimary = 'rounded-md bg-primary px-2.5 py-1.5 text-[12px] text-primary-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none'
const btnOutline = 'rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-40 disabled:pointer-events-none hover:bg-accent'

// THINKING_OPTS labels are i18n-driven; built in component

export function PiSettingsPanel() {
  const { t } = useTranslation()
  const THINKING_OPTS = [
    { v: 'off', l: t('settings:pi.thinkingOff') },
    { v: 'minimal', l: t('settings:pi.thinkingMinimal') },
    { v: 'low', l: t('settings:pi.thinkingLow') },
    { v: 'medium', l: t('settings:pi.thinkingMedium') },
    { v: 'high', l: t('settings:pi.thinkingHigh') },
    { v: 'xhigh', l: t('settings:pi.thinkingXhigh') },
  ]
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
      setLoadError(e?.message || t('settings:pi.loadError'))
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
        if (event.error) toast.error(`${t('settings:pi.upgradeFailed')}: ${event.error}`)
        else toast.success(t('settings:pi.upgradeSuccess'))
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
        toast.error(res.error || t('settings:pi.upgradeFailed'))
      }
    } catch (e: any) {
      setInstalling(false)
      toast.error(e?.message || t('settings:pi.upgradeFailed'))
    }
  }, [selectedVersion])

  const onSwitchEnv = useCallback(async (target: 'builtin' | 'global' | 'user') => {
    setSwitching(true)
    try {
      const res = await ipcClient.invoke('sdk.switch', { target })
      if (res?.ok === false) {
        toast.error(res.error || t('settings:pi.switchFailed'))
        return
      }
      const label = target === 'builtin' ? t('settings:pi.switchSuccessBuiltin') : target === 'global' ? t('settings:pi.switchSuccessGlobal') : t('settings:pi.switchSuccessUser')
      toast.success(label)
      void reloadSdk()
    } catch (e: any) {
      toast.error(e?.message || t('settings:pi.switchFailed'))
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
    label: t('settings:pi.title'),
    isDirty: () => !settingsEqual(draft, baseline),
    commit: async () => {
      if (!draft || settingsEqual(draft, baseline)) return
      const defaultModelChanged =
        String(baseline?.defaultProvider ?? '') !== String(draft.defaultProvider ?? '') ||
        String(baseline?.defaultModel ?? '') !== String(draft.defaultModel ?? '')
      const res = await ipcClient.invoke('pi.settings.set', { patch: draft })
      if (res?.ok === false) throw new Error(res.error || t('common:saveFailed'))
      await reloadPiForm()
      if (defaultModelChanged) {
        await applyPiDefaultModelToWorkerSession()
      } else {
        await refreshComposerRunDisplay()
      }
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
    return <p className="text-[13px] text-muted-foreground">{t('settings:pi.loading')}</p>
  }

  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{t('settings:pi.title')}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            {t('settings:pi.description')}
          </p>
        </div>
      </div>

      {loadError && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          {loadError}{' '}{t('settings:pi.loadErrorHint')}
        </div>
      )}

      <Section title={t('settings:pi.sectionEnvAuth')}>
        {/* SDK 版本管理 */}
        <div className="py-3 border-b border-border/40">
          <div className="mb-2 text-[13px] font-medium text-foreground">{t('settings:pi.sdkManagement')}</div>
          <div className="grid grid-cols-1 gap-1.5 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('settings:pi.builtinVersion')}</span>
              <span className="font-mono text-muted-foreground">{sdkStatus?.builtinVersion || info?.sdkVersion || '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('settings:pi.globalVersion')}</span>
              <span className="font-mono text-muted-foreground">{sdkStatus?.globalVersion || t('settings:pi.notDetected')}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('settings:pi.userVersion')}</span>
              <span className="font-mono text-muted-foreground">{sdkStatus?.userVersion || t('settings:pi.notInstalled')}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('settings:pi.activeVersion')}</span>
              <span className="font-mono text-foreground">
                {sdkStatus?.active?.version || '—'} ({sdkStatus?.active?.kind === 'global' ? t('settings:pi.kindGlobal') : sdkStatus?.active?.kind === 'user' ? t('settings:pi.kindUser') : t('settings:pi.kindBuiltin')})
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('settings:pi.registryLatest')}</span>
              <span className="font-mono text-muted-foreground">{registry?.latest || (registry ? '—' : t('settings:pi.loadingShort'))}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">npm</span>
              <span className="font-mono text-muted-foreground">
                {sdkStatus?.npmAvailable ? t('settings:pi.npmAvailable') : t('settings:pi.npmNotDetected')}
              </span>
            </div>
          </div>
          {sdkStatus?.active?.fallbackReason && (
            <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              {sdkStatus.active.kind === 'user' ? t('settings:pi.fallbackUser') : t('settings:pi.fallbackGlobal')}
            </div>
          )}
          {sdkStatus?.workerFallback && (
            <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              {t('settings:pi.fallbackWorker')}
            </div>
          )}
          {/* 切换生效环境 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground/70">{t('settings:pi.switchEnv')}</span>
            <select
              className={cn(selectCls, 'min-w-[8rem]')}
              value={envTarget}
              disabled={switching || installing}
              onChange={(e) => setEnvTarget(e.target.value as 'builtin' | 'global' | 'user')}
            >
              <option value="builtin">{t('settings:pi.switchEnvBuiltin')}</option>
              <option value="global" disabled={!sdkStatus?.globalVersion}>{t('settings:pi.switchEnvGlobal')}{!sdkStatus?.globalVersion ? t('settings:pi.switchEnvGlobalNotDetected') : ''}</option>
              <option value="user" disabled={!sdkStatus?.userVersion}>{t('settings:pi.switchEnvUser')}{!sdkStatus?.userVersion ? t('settings:pi.switchEnvUserNotInstalled') : ''}</option>
            </select>
            <button
              type="button"
              className={btnOutline}
              disabled={switching || installing || envTarget === sdkStatus?.active?.kind || (envTarget === 'global' && !sdkStatus?.globalVersion) || (envTarget === 'user' && !sdkStatus?.userVersion)}
              onClick={() => onSwitchEnv(envTarget)}
            >
              {switching ? t('settings:pi.switching') : t('settings:pi.switch')}
            </button>
          </div>
          {/* 升级独立环境（覆盖式安装） */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground/70">{t('settings:pi.upgradeEnv')}</span>
            <select
              className={cn(selectCls, 'min-w-[8rem]')}
              value={selectedVersion}
              disabled={installing || !sdkStatus?.npmAvailable}
              onChange={(e) => setSelectedVersion(e.target.value)}
            >
              <option value="">{t('settings:pi.selectVersion')}</option>
              {(registry?.versions || []).slice().reverse().map((v) => (
                <option key={v} value={v}>
                  {v}{v === registry?.latest ? ` ${t('settings:pi.latest')}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={btnPrimary}
              disabled={installing || !selectedVersion || !sdkStatus?.npmAvailable}
              onClick={onInstall}
            >
              {installing ? t('settings:pi.installing') : t('settings:pi.upgradeSwitch')}
            </button>
          </div>
          {(installing || installOutput.length > 0) && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/50 p-2 text-[10px] font-mono whitespace-pre-wrap text-muted-foreground">
              {installOutput.join('\n')}{installing ? '\n…' : ''}
            </pre>
          )}
        </div>
        <Row label={t('settings:pi.agentDir')} description={t('settings:pi.agentDirDesc')}>
          <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground" title={info?.agentDir}>
            {info?.agentDir || '~/.pi/agent'}
          </span>
        </Row>
        <Row label={t('settings:pi.auth')} description={t('settings:pi.authDesc')}>
          <div className="flex items-center gap-1.5">
            {info?.authStatus === 'configured' ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-500" />
                <span className="text-[12px] text-green-600 dark:text-green-400">{t('settings:pi.authConfigured')}</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
                <span className="text-[12px] text-muted-foreground">{t('settings:pi.authNotConfigured')}</span>
              </>
            )}
          </div>
        </Row>
        {info?.authProviders?.length > 0 && (
          <Row label={t('settings:pi.provider')} description={t('settings:pi.providerDesc')}>
            <div className="flex max-w-xs flex-wrap justify-end gap-1">
              {info.authProviders.map((p: any) => (
                <span key={p.provider} className="rounded border border-border/50 px-1.5 py-0.5 font-mono text-[10px]">
                  {p.provider}
                </span>
              ))}
            </div>
          </Row>
        )}
        <Row label={t('settings:pi.sessionDir')} description={t('settings:pi.sessionDirDesc')}>
          <span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
            {String(ui?.sessionDir || t('settings:pi.sessionDirDefault'))}
          </span>
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionModelInference')}>
        <Row label={t('settings:pi.defaultModel')} description={t('settings:pi.defaultModelDesc')}>
          <select
            className={cn(selectCls, 'min-w-[min(280px,70vw)]')}
            value={currentModelKey}
            disabled={!ui || modelOptions.length === 0}
            onChange={(e) => onModelSelect(e.target.value)}
          >
            <option value="">{t('settings:pi.notSet')}</option>
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
        <Row label={t('settings:pi.defaultThinking')} description={t('settings:pi.defaultThinkingDesc')}>
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
        <Row label={t('settings:pi.modelWhitelist')} description={t('settings:pi.modelWhitelistDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`enabledModels-${formEpoch}`}
            defaultValue={Array.isArray(ui?.enabledModels) ? (ui.enabledModels as string[]).join(', ') : ''}
            placeholder={t('settings:pi.modelWhitelistPlaceholder')}
            onBlur={(e) => {
              const raw = e.target.value.trim()
              const patterns = raw ? raw.split(/,\s*/).filter(Boolean) : undefined
              queuePatch({ enabledModels: patterns })
            }}
          />
        </Row>
        <Row label={t('settings:pi.hideThinking')} description={t('settings:pi.hideThinkingDesc')}>
          <Toggle
            on={!!ui?.hideThinkingBlock}
            disabled={!ui}
            onChange={(v) => queuePatch({ hideThinkingBlock: v })}
          />
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionQueueTransport')}>
        <Row label={t('settings:pi.steeringMode')} description={t('settings:pi.steeringModeDesc')}>
          <select
            className={selectCls}
            value={String(ui?.steeringMode || 'all')}
            disabled={!ui}
            onChange={(e) => queuePatch({ steeringMode: e.target.value })}
          >
            <option value="all">{t('settings:pi.steeringAll')}</option>
            <option value="one-at-a-time">{t('settings:pi.steeringOneAtATime')}</option>
          </select>
        </Row>
        <Row label={t('settings:pi.followUpMode')} description={t('settings:pi.followUpModeDesc')}>
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
        <Row label={t('settings:pi.transport')} description={t('settings:pi.transportDesc')}>
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
        <Row label={t('settings:pi.httpIdleTimeout')} description={t('settings:pi.httpIdleTimeoutDesc', { ms: ui?.httpIdleTimeoutMs ?? '—' })}>
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

      <Section title={t('settings:pi.sectionCompactionRetry')}>
        <Row label={t('settings:pi.autoCompaction')} description={t('settings:pi.autoCompactionDesc')}>
          <Toggle
            on={ui?.compactionEnabled !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ compactionEnabled: v })}
          />
        </Row>
        <Row label={t('settings:pi.compactionReserve')} description={t('settings:pi.compactionReserveDesc')}>
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
        <Row label={t('settings:pi.compactionKeep')} description={t('settings:pi.compactionKeepDesc')}>
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
        <Row label={t('settings:pi.retryEnabled')} description={t('settings:pi.retryEnabledDesc')}>
          <Toggle
            on={ui?.retryEnabled !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ retryEnabled: v })}
          />
        </Row>
        <Row label={t('settings:pi.retryParams')} description={t('settings:pi.retryParamsDesc')}>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('settings:pi.retryParamsValue', { max: String(ui?.retryMaxRetries), delay: String(ui?.retryBaseDelayMs) })}
          </span>
        </Row>
        <Row label={t('settings:pi.branchSummary')} description={t('settings:pi.branchSummaryDesc')}>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('settings:pi.branchSummaryValue', { reserve: String(ui?.branchSummaryReserveTokens), skip: ui?.branchSummarySkipPrompt ? t('settings:pi.yes') : t('settings:pi.no') })}
          </span>
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionToolShell')}>
        <Row label={t('settings:pi.shellPath')} description={t('settings:pi.shellPathDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`shellPath-${formEpoch}`}
            placeholder={t('settings:pi.shellPathPlaceholder')}
            defaultValue={String(ui?.shellPath || '')}
            onBlur={(e) => queuePatch({ shellPath: e.target.value || undefined })}
          />
        </Row>
        <Row label={t('settings:pi.shellPrefix')} description={t('settings:pi.shellPrefixDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`shellPrefix-${formEpoch}`}
            defaultValue={String(ui?.shellCommandPrefix || '')}
            onBlur={(e) => queuePatch({ shellCommandPrefix: e.target.value || undefined })}
          />
        </Row>
        <Row label={t('settings:pi.npmCommand')} description={t('settings:pi.npmCommandDesc')}>
          <input
            className={inputCls}
            disabled={!ui}
            key={`npm-${formEpoch}`}
            defaultValue={String(ui?.npmCommand || '')}
            placeholder="npm"
            onBlur={(e) => queuePatch({ npmCommand: e.target.value || undefined })}
          />
        </Row>
        <Row label={t('settings:pi.imageAutoResize')} description={t('settings:pi.imageAutoResizeDesc')}>
          <Toggle
            on={!!ui?.imageAutoResize}
            disabled={!ui}
            onChange={(v) => queuePatch({ imageAutoResize: v })}
          />
        </Row>
        <Row label={t('settings:pi.showImages')} description={t('settings:pi.showImagesDesc')}>
          <Toggle
            on={ui?.showImages !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ showImages: v })}
          />
        </Row>
        <Row label={t('settings:pi.blockImages')} description={t('settings:pi.blockImagesDesc')}>
          <Toggle
            on={!!ui?.blockImages}
            disabled={!ui}
            onChange={(v) => queuePatch({ blockImages: v })}
          />
        </Row>
      </Section>

      <Section title={t('settings:pi.sectionSkillStartup')}>
        <Row label={t('settings:pi.defaultProjectTrust')} description={t('settings:pi.defaultProjectTrustDesc')}>
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
        <Row label={t('settings:pi.skillCommands')} description={t('settings:pi.skillCommandsDesc')}>
          <Toggle
            on={ui?.enableSkillCommands !== false}
            disabled={!ui}
            onChange={(v) => queuePatch({ enableSkillCommands: v })}
          />
        </Row>
        <Row label={t('settings:pi.quietStartup')} description={t('settings:pi.quietStartupDesc')}>
          <Toggle on={!!ui?.quietStartup} disabled={!ui} onChange={(v) => queuePatch({ quietStartup: v })} />
        </Row>
      </Section>
      <p className="pt-2 text-[10px] text-muted-foreground/55">
        {t('settings:pi.treeHint')}
      </p>
    </div>
  )
}