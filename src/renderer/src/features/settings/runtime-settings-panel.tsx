import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { selectCls, btnOutline } from './settings-controls'
import { useSettingsDraft } from './settings-draft-context'

type WslDistroInfo = { name: string; version?: number; isDefault: boolean }
type WslProbeResult = {
  ok: boolean
  distro: string
  node: boolean
  nodeVersion?: string
  npm: boolean
  git: boolean
  pi: boolean
  supportsCd: boolean
  error?: string
}

export function RuntimeSettingsPanel() {
  const { t } = useTranslation()
  const { draft, setAgentRuntime } = useSettingsDraft()
  const isWindows = useMemo(() => (window.piDesktop?.platform ?? '') === 'win32', [])
  const [distros, setDistros] = useState<WslDistroInfo[]>([])
  const [probe, setProbe] = useState<WslProbeResult | null>(null)
  const [probeState, setProbeState] = useState<'idle' | 'checking'>('idle')

  const runtime = draft.agentRuntime

  useEffect(() => {
    if (!isWindows) return
    void ipcClient
      .invoke('wsl.listDistros', {})
      .then((res) => {
        const list = (res?.distros as WslDistroInfo[] | undefined) || []
        setDistros(list)
      })
      .catch(() => setDistros([]))
  }, [isWindows])

  useEffect(() => {
    if (runtime.mode !== 'wsl' || !runtime.distro) {
      setProbe(null)
      setProbeState('idle')
      return
    }
    setProbeState('checking')
    void ipcClient
      .invoke('wsl.probeDistro', { distro: runtime.distro })
      .then((res) => {
        setProbe((res?.result as WslProbeResult | undefined) ?? null)
      })
      .catch(() => {
        setProbe(null)
      })
      .finally(() => setProbeState('idle'))
  }, [runtime.mode, runtime.distro])

  const selectedExists = distros.some((d) => d.name === runtime.distro)

  return (
    <SettingsSection title={t('settings:runtime.sectionAgentRuntime')} description={t('settings:runtime.sectionAgentRuntimeDesc')}>
      <SettingRow label={t('settings:runtime.mode')} description={t('settings:runtime.modeDesc')}>
        <select
          className={cn(selectCls, 'min-w-[min(220px,60vw)]')}
          value={runtime.mode}
          onChange={(e) => {
            const mode = e.target.value as 'host' | 'wsl'
            setAgentRuntime({
              mode,
              distro: mode === 'wsl' && runtime.distro ? runtime.distro : null,
            })
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
              <option value="">{t('settings:runtime.distroNone')}</option>
              {distros.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                  {d.isDefault ? ` (${t('settings:runtime.distroDefault')})` : ''}
                  {typeof d.version === 'number' ? ` (WSL${d.version})` : ''}
                </option>
              ))}
            </select>
          </SettingRow>

          {runtime.distro && !selectedExists && (
            <SettingRow label={t('settings:runtime.distroMissing')} description={t('settings:runtime.distroMissingDesc', { distro: runtime.distro })}>
              <span className="text-xs text-destructive/80">{t('settings:runtime.distroMissingLabel')}</span>
            </SettingRow>
          )}

          {runtime.distro && (
            <SettingRow label={t('settings:runtime.probe')} description={probeStatusText(probe, probeState, t)}>
              <button
                type="button"
                className={cn(btnOutline, 'text-xs')}
                disabled={probeState === 'checking'}
                onClick={() => {
                  setProbeState('checking')
                  void ipcClient
                    .invoke('wsl.probeDistro', { distro: runtime.distro })
                    .then((res) => setProbe((res?.result as WslProbeResult | undefined) ?? null))
                    .catch(() => setProbe(null))
                    .finally(() => setProbeState('idle'))
                }}
              >
                {t('settings:runtime.probeButton')}
              </button>
            </SettingRow>
          )}
        </>
      )}
    </SettingsSection>
  )
}

function probeStatusText(
  probe: WslProbeResult | null,
  probeState: 'idle' | 'checking',
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (probeState === 'checking') return t('settings:runtime.probeChecking')
  if (!probe) return t('settings:runtime.probeIdle')
  const parts: string[] = []
  parts.push(probe.node ? `node ${probe.nodeVersion ?? ''}`.trim() : t('settings:runtime.missingNode'))
  parts.push(probe.npm ? 'npm' : t('settings:runtime.missingNpm'))
  parts.push(probe.git ? 'git' : t('settings:runtime.missingGit'))
  parts.push(probe.pi ? 'pi' : t('settings:runtime.missingPi'))
  if (!probe.supportsCd) parts.push(t('settings:runtime.noCdFlag'))
  if (probe.error) return `${probe.error} · ${parts.join(' · ')}`
  return parts.join(' · ')
}
