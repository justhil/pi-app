import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, ExternalLink, Search, KeyRound } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { cn } from '@renderer/lib/utils'

type CodexProbe = {
  ok: boolean
  authFile: string | null
  authMode?: string
  source?: 'manual' | 'file'
  tokenPreview?: string
  detail?: string
}

export function VoiceSettingsPanel() {
  const { t } = useTranslation()
  const { draft, dirty, setAsrConfig } = useSettingsDraft()
  const cfg = draft.asrConfig
  const [probe, setProbe] = useState<CodexProbe | null>(null)
  const [probing, setProbing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(
    cfg.provider === 'codex-asr-cli' || cfg.provider === 'codex-asr-serve',
  )

  const runProbe = useCallback(async () => {
    setProbing(true)
    try {
      const res = await ipcClient.invoke('asr.probeCodexAuth', {
        config: {
          codexAuthFile: cfg.codexAuthFile,
          codexAccessToken: cfg.codexAccessToken,
        },
      })
      setProbe(res as CodexProbe)
    } catch (e: unknown) {
      setProbe({ ok: false, authFile: null, detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setProbing(false)
    }
  }, [cfg.codexAuthFile, cfg.codexAccessToken])

  useEffect(() => {
    if (cfg.provider === 'none') {
      setAsrConfig({ provider: 'codex-asr-builtin' })
    }
  }, [])  

  useEffect(() => {
    void runProbe()
  }, [runProbe])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const testCfg =
        cfg.provider === 'none' || cfg.provider === 'codex-asr-builtin'
          ? { ...cfg, provider: 'codex-asr-builtin' as const }
          : cfg
      const res = await ipcClient.invoke('asr.testConnection', { config: testCfg })
      if (res?.ok) {
        setTestResult(`${t('settings:voice.testSuccess')}${res.detail ? `: ${res.detail}` : ''}`)
      } else {
        setTestResult(`${t('settings:voice.testFailed')}${res?.detail ? `: ${res.detail}` : ''}`)
      }
    } catch (e: unknown) {
      setTestResult(`${t('settings:voice.testFailed')}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  const inputCls = 'w-full max-w-md rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono'
  const selectCls = 'max-w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] min-w-[10rem]'
  const btnOutline = 'rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] transition-colors hover:bg-accent disabled:opacity-40'

  const useBuiltin = cfg.provider === 'codex-asr-builtin' || cfg.provider === 'none'
  const testSuccessPrefix = t('settings:voice.testSuccess')

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('settings:voice.title')} description={t('settings:voice.descriptionBuiltin')} />

      {dirty && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200">
          {t('settings:voice.unsavedVoiceHint')}
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border/40">
          <div>
            <div className="text-[13px] font-medium text-foreground">{t('settings:voice.builtinTitle')}</div>
            <div className="text-[11px] text-muted-foreground/70">{t('settings:voice.builtinDesc')}</div>
          </div>
          <button
            type="button"
            className={cn(btnOutline, useBuiltin && 'border-primary/50 bg-primary/5')}
            onClick={() => setAsrConfig({ provider: 'codex-asr-builtin' })}
          >
            {useBuiltin ? t('settings:voice.builtinOn') : t('settings:voice.builtinEnable')}
          </button>
        </div>

        <div className="py-2 border-b border-border/40 space-y-2">
          <div className="text-[13px] font-medium text-foreground">{t('settings:voice.codexLogin')}</div>
          <div className="text-[11px] text-muted-foreground/65">{t('settings:voice.codexLoginDesc')}</div>
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-foreground/90">{t('settings:voice.accessTokenManual')}</div>
            <textarea
              className={cn(inputCls, 'min-h-[4.5rem] max-w-xl resize-y')}
              value={cfg.codexAccessToken || ''}
              placeholder={t('settings:voice.accessTokenPlaceholder')}
              spellCheck={false}
              onChange={(e) => setAsrConfig({ codexAccessToken: e.target.value || undefined })}
              onBlur={() => void runProbe()}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnOutline} disabled={probing} onClick={() => void runProbe()}>
                <KeyRound className="mr-1 inline h-3.5 w-3.5" />
                {probing ? t('settings:voice.detecting') : t('settings:voice.verifyAuth')}
              </button>
              <button
                type="button"
                className={btnOutline}
                onClick={async () => {
                  const res = await ipcClient.invoke('asr.importCodexAccessToken', {
                    codexAuthFile: cfg.codexAuthFile,
                  })
                  if (res?.ok && res.accessToken) {
                    setAsrConfig({ codexAccessToken: res.accessToken })
                    void runProbe()
                  }
                }}
              >
                {t('settings:voice.fillFromAuthFile')}
              </button>
            </div>
          </div>
          {probe && (
            <div
              className={cn(
                'rounded-md border px-2.5 py-2 text-[11px]',
                probe.ok ? 'border-green-500/30 bg-green-500/5 text-green-800 dark:text-green-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200',
              )}
            >
              {probe.ok ? (
                <>
                  <div>
                    {t('settings:voice.codexAuthOk')}
                    {probe.source === 'manual' ? ` (${t('settings:voice.authSourceManual')})` : probe.source === 'file' ? ` (${t('settings:voice.authSourceFile')})` : ''}
                  </div>
                  {probe.authFile && <div className="mt-0.5 font-mono opacity-80">{probe.authFile}</div>}
                  {probe.tokenPreview && (
                    <div className="mt-0.5">{t('settings:voice.tokenPreview', { preview: probe.tokenPreview })}</div>
                  )}
                </>
              ) : (
                <div>{probe.detail || t('settings:voice.codexAuthMissing')}</div>
              )}
            </div>
          )}
          <div className="pt-1">
            <div className="text-[12px] font-medium text-foreground/90">{t('settings:voice.authFileOverride')}</div>
            <input
              className={cn(inputCls, 'mt-1')}
              value={cfg.codexAuthFile || ''}
              placeholder={t('settings:voice.authFilePlaceholder')}
              onChange={(e) => setAsrConfig({ codexAuthFile: e.target.value || undefined })}
            />
          </div>
        </div>

        {useBuiltin && (
          <>
            <div className="py-2 border-b border-border/40">
              <div className="text-[13px] font-medium text-foreground mb-1">{t('settings:voice.language')}</div>
              <select
                className={selectCls}
                value={cfg.language || 'auto'}
                onChange={(e) => setAsrConfig({ language: e.target.value as 'auto' | 'zh' | 'en' })}
              >
                <option value="auto">{t('settings:voice.languageAuto')}</option>
                <option value="zh">{t('settings:voice.langZh')}</option>
                <option value="en">{t('settings:voice.langEn')}</option>
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground/70">{t('settings:voice.builtinRuntimeHint')}</p>
            <div className="py-2">
              <button type="button" className={btnOutline} disabled={testing} onClick={() => void handleTest()}>
                {testing ? t('settings:voice.testing') : t('settings:voice.testConnection')}
              </button>
              {testResult && (
                <div
                  className={cn(
                    'mt-2 text-[11px]',
                    testResult.startsWith(testSuccessPrefix) ? 'text-green-600 dark:text-green-400' : 'text-destructive',
                  )}
                >
                  {testResult}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        className="text-[12px] text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? t('settings:voice.hideAdvanced') : t('settings:voice.showAdvanced')}
      </button>

      {showAdvanced && (
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3">
          <p className="text-[11px] text-muted-foreground/70">{t('settings:voice.advancedHint')}</p>
          <div className="flex items-center justify-between py-2 border-b border-border/40">
            <div className="text-[13px] font-medium text-foreground">{t('settings:voice.provider')}</div>
            <select
              className={selectCls}
              value={cfg.provider === 'codex-asr-builtin' || cfg.provider === 'none' ? 'codex-asr-cli' : cfg.provider}
              onChange={(e) => setAsrConfig({ provider: e.target.value as typeof cfg.provider })}
            >
              <option value="codex-asr-cli">{t('settings:voice.providerCli')}</option>
              <option value="codex-asr-serve">{t('settings:voice.providerServe')}</option>
            </select>
          </div>
          {cfg.provider === 'codex-asr-cli' && (
            <div className="py-2 space-y-2">
              <div className="text-[11px] text-muted-foreground/70">{t('settings:voice.cliBinaryPathDesc')}</div>
              <input
                className={inputCls}
                value={cfg.cliBinaryPath || ''}
                placeholder="codex-asr"
                onChange={(e) => setAsrConfig({ cliBinaryPath: e.target.value })}
              />
              <button
                type="button"
                className={cn(btnOutline, 'mt-2')}
                onClick={async () => {
                  const res = await ipcClient.invoke('asr.detectBinary')
                  if (res?.path) setAsrConfig({ cliBinaryPath: res.path })
                }}
              >
                <Search className="mr-1 inline h-3.5 w-3.5" />
                {t('settings:voice.autoDetect')}
              </button>
            </div>
          )}
          {cfg.provider === 'codex-asr-serve' && (
            <>
              <div className="text-[11px] text-muted-foreground/70">{t('settings:voice.serverUrlDesc')}</div>
              <input
                className={inputCls}
                value={cfg.serverUrl || ''}
                placeholder="http://127.0.0.1:8788"
                onChange={(e) => setAsrConfig({ serverUrl: e.target.value })}
              />
              <input
                type="password"
                className={cn(inputCls, 'mt-2')}
                value={cfg.apiKey || ''}
                placeholder={t('settings:voice.localApiKeyPlaceholder')}
                onChange={(e) => setAsrConfig({ apiKey: e.target.value })}
              />
            </>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Mic className="h-4 w-4 shrink-0" />
          <span>{t('settings:voice.cliInstallHint')}</span>
          <a href={t('settings:voice.installUrl')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            codex-asr <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  )
}