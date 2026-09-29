import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { AlertTriangle, Check, Copy, Loader2, RefreshCw, XCircle } from '@renderer/components/icons'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { selectCls, btnOutline } from './settings-controls'
import { useSettingsDraft } from './settings-draft-context'

type WslDistroInfo = { name: string; version?: number; isDefault: boolean }
type WslProbeResult = {
  ok: boolean
  distro: string
  node: boolean
  nodeVersion?: string
  nodePath?: string
  npm: boolean
  git: boolean
  pi: boolean
  sdk?: boolean
  sdkVersion?: string
  sdkPath?: string
  home?: string
  shell?: string
  envMode?: 'interactive-login' | 'login' | 'plain'
  pathExtras?: string[]
  supportsCd: boolean
  error?: string
}

const INSTALL_PI = 'npm i -g @earendil-works/pi-coding-agent'

export function RuntimeSettingsPanel() {
  const { t } = useTranslation()
  const { draft, setAgentRuntime } = useSettingsDraft()
  const isWindows = useMemo(() => (window.piDesktop?.platform ?? '') === 'win32', [])
  const [distros, setDistros] = useState<WslDistroInfo[] | null>(null)
  const [probe, setProbe] = useState<WslProbeResult | null>(null)
  const [probeState, setProbeState] = useState<'idle' | 'checking'>('idle')

  const runtime = draft.agentRuntime

  useEffect(() => {
    if (!isWindows) return
    void ipcClient
      .invoke('wsl.listDistros', {})
      .then((res) => setDistros((res?.distros as WslDistroInfo[] | undefined) || []))
      .catch(() => setDistros([]))
  }, [isWindows])

  // Without `refresh` the main process answers from the captured environment (instant); the
  // button re-captures it (runs the login shell inside the distro, a few seconds).
  const runProbe = useCallback((distro: string, refresh: boolean) => {
    setProbeState('checking')
    void ipcClient
      .invoke('wsl.probeDistro', { distro, refresh })
      .then((res) => setProbe((res?.result as WslProbeResult | undefined) ?? null))
      .catch(() => setProbe(null))
      .finally(() => setProbeState('idle'))
  }, [])

  useEffect(() => {
    if (runtime.mode !== 'wsl' || !runtime.distro) {
      setProbe(null)
      setProbeState('idle')
      return
    }
    runProbe(runtime.distro, false)
  }, [runtime.mode, runtime.distro, runProbe])

  const selectedExists = !distros || distros.some((d) => d.name === runtime.distro)

  return (
    <SettingsSection title={t('settings:runtime.sectionAgentRuntime')} description={t('settings:runtime.sectionAgentRuntimeDesc')}>
      <SettingRow label={t('settings:runtime.mode')} description={t('settings:runtime.modeDesc')}>
        <select
          className={cn(selectCls, 'min-w-[min(220px,60vw)]')}
          value={runtime.mode}
          onChange={(e) => {
            const mode = e.target.value as 'host' | 'wsl'
            const fallbackDistro = distros?.find((d) => d.isDefault)?.name ?? distros?.[0]?.name ?? null
            setAgentRuntime({ mode, distro: mode === 'wsl' ? (runtime.distro ?? fallbackDistro) : null })
          }}
        >
          <option value="host">{t('settings:runtime.modeHost')}</option>
          <option value="wsl" disabled={!isWindows}>
            {t('settings:runtime.modeWsl')}
          </option>
        </select>
      </SettingRow>

      {!isWindows && (
        <SettingRow label={t('settings:runtime.platformUnavailable')} description={t('settings:runtime.platformUnavailableDesc')}>
          <span className="text-xs text-muted-foreground/70">{window.piDesktop?.platform ?? 'unknown'}</span>
        </SettingRow>
      )}

      {runtime.mode === 'wsl' && isWindows && (
        <>
          <SettingRow label={t('settings:runtime.distro')} description={t('settings:runtime.distroDesc')}>
            <select
              className={cn(selectCls, 'min-w-[min(220px,60vw)]')}
              value={runtime.distro ?? ''}
              onChange={(e) => setAgentRuntime({ mode: 'wsl', distro: e.target.value || null })}
            >
              <option value="">{distros === null ? t('settings:runtime.distroLoading') : t('settings:runtime.distroNone')}</option>
              {(distros ?? []).map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                  {d.isDefault ? ` (${t('settings:runtime.distroDefault')})` : ''}
                  {typeof d.version === 'number' ? ` (WSL${d.version})` : ''}
                </option>
              ))}
            </select>
          </SettingRow>

          {distros?.length === 0 && (
            <SettingRow label={t('settings:runtime.noDistros')} description={t('settings:runtime.noDistrosDesc')}>
              <CopyCommand command="wsl --install -d Ubuntu" />
            </SettingRow>
          )}

          {runtime.distro && !selectedExists && (
            <SettingRow label={t('settings:runtime.distroMissing')} description={t('settings:runtime.distroMissingDesc', { distro: runtime.distro })}>
              <span className="text-xs text-destructive/80">{t('settings:runtime.distroMissingLabel')}</span>
            </SettingRow>
          )}

          {runtime.distro && (
            <WslEnvironmentCard
              probe={probe}
              checking={probeState === 'checking'}
              onRefresh={() => runtime.distro && runProbe(runtime.distro, true)}
            />
          )}
        </>
      )}
    </SettingsSection>
  )
}

type CheckTone = 'ok' | 'warn' | 'bad'

function CheckItem({ tone, label, value, children }: { tone: CheckTone; label: string; value?: ReactNode; children?: ReactNode }) {
  const Icon = tone === 'ok' ? Check : tone === 'warn' ? AlertTriangle : XCircle
  return (
    <li className="wsl-check-item" data-tone={tone}>
      <Icon className="wsl-check-icon h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[12.5px] font-medium text-foreground">{label}</span>
          {value ? <span className="min-w-0 truncate font-mono text-[11.5px] text-foreground-secondary">{value}</span> : null}
        </div>
        {children}
      </div>
    </li>
  )
}

function CopyCommand({ command }: { command: string }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="wsl-copy-command"
      title={t('settings:runtime.copyCommand')}
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => toast.success(t('settings:runtime.copied')))
      }}
    >
      <code>{command}</code>
      <Copy className="h-3 w-3 shrink-0" />
    </button>
  )
}

/**
 * What the worker will actually run with inside the distro — the user's login-shell environment
 * captured by the main process — as a checklist with the fix for anything missing.
 */
function WslEnvironmentCard({
  probe,
  checking,
  onRefresh,
}: {
  probe: WslProbeResult | null
  checking: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const status: 'checking' | 'ready' | 'blocked' | 'unknown' = checking && !probe
    ? 'checking'
    : !probe
      ? 'unknown'
      : probe.ok
        ? 'ready'
        : 'blocked'
  const extras = probe?.pathExtras ?? []

  return (
    <div className="wsl-env-card" data-status={status}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
            {t('settings:runtime.envTitle')}
            <span className="settings-badge" data-tone={status === 'blocked' ? 'warn' : undefined}>
              {t(`settings:runtime.envStatus.${status}`)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] leading-[1.55] text-foreground-secondary">{t('settings:runtime.envDesc')}</p>
        </div>
        <button type="button" className={cn(btnOutline, 'shrink-0 text-xs')} disabled={checking} onClick={onRefresh}>
          {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {checking ? t('settings:runtime.probeChecking') : t('settings:runtime.probeButton')}
        </button>
      </div>

      {probe && probe.home ? (
        <ul className="wsl-check-list">
          <CheckItem
            tone={probe.node ? 'ok' : 'bad'}
            label="Node.js"
            value={probe.node ? `${probe.nodeVersion ?? ''} · ${probe.nodePath ?? ''}` : t('settings:runtime.missing')}
          />
          <CheckItem
            tone={probe.sdk ? 'ok' : 'bad'}
            label={t('settings:runtime.sdkLabel')}
            value={probe.sdk ? `${probe.sdkVersion ?? ''} · ${probe.sdkPath ?? ''}` : t('settings:runtime.missing')}
          >
            {!probe.sdk && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-foreground-secondary">
                {t('settings:runtime.sdkInstallHint')}
                <CopyCommand command={INSTALL_PI} />
              </div>
            )}
          </CheckItem>
          <CheckItem tone={probe.npm ? 'ok' : 'warn'} label="npm" value={probe.npm ? undefined : t('settings:runtime.missing')} />
          <CheckItem
            tone={probe.git ? 'ok' : 'warn'}
            label="git"
            value={probe.git ? undefined : t('settings:runtime.gitMissingHint')}
          />
          <CheckItem
            tone={probe.envMode === 'plain' ? 'warn' : 'ok'}
            label={t('settings:runtime.shellLabel')}
            value={`${probe.shell ?? ''} · ${t(`settings:runtime.envMode.${probe.envMode ?? 'plain'}`)}`}
          >
            {extras.length > 0 && (
              <div className="mt-1 text-[11.5px] leading-[1.5] text-foreground-secondary">
                {t('settings:runtime.pathExtras', { count: extras.length })}{' '}
                <span className="font-mono">{extras.slice(0, 4).join('  ')}{extras.length > 4 ? ' …' : ''}</span>
              </div>
            )}
          </CheckItem>
          {!probe.supportsCd && <CheckItem tone="warn" label={t('settings:runtime.noCdFlag')} />}
        </ul>
      ) : status === 'checking' ? (
        <div className="wsl-env-skeleton" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-destructive/80">{probe?.error || t('settings:runtime.probeIdle')}</p>
      )}

      <p className="mt-3 border-t border-border/40 pt-2.5 text-[11.5px] leading-[1.55] text-foreground-secondary/85">
        {t('settings:runtime.fsHint')}
      </p>
    </div>
  )
}
