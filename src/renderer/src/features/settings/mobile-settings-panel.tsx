import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection, Toggle } from '@renderer/features/settings/settings-page-shared'
import { btnCompact, numberInputCls, selectCls } from '@renderer/features/settings/settings-controls'
import { cn } from '@renderer/lib/utils'
import { projectGroups } from '@renderer/features/settings/mobile-project-groups'

type Device = {
  id: string
  name: string
  platform: string
  role: 'viewer' | 'operator'
  createdAt: number
  lastSeenAt?: number
  revokedAt?: number
  fingerprint: string
  online: boolean
}

type RemoteStatus = {
  enabled: boolean
  listening: boolean
  port: number
  error?: string
  endpoints: string[]
  hostName: string
  hostKeyEphemeral: boolean
  pairing: { link: string; exp: number } | null
  qrSvg?: string
  devices: Device[]
  projects: string[]
  trustedProjects: string[]
  projectInfo?: Record<string, { label?: string; temporary?: boolean }>
}

const POLL_MS = 3000
const projectName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
const sameProject = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

/** Settings → 手机连接: gateway switch, pairing QR, paired devices, project whitelist. */
export function MobileSettingsPanel() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [portDraft, setPortDraft] = useState('')
  const now = useNow(!!status?.pairing)
  const [projectQuery, setProjectQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const call = useCallback(async (channel: string, request?: unknown) => {
    setBusy(true)
    try {
      const next = (await ipcClient.invoke(channel, request)) as RemoteStatus
      setStatus(next)
      return next
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const load = () =>
      ipcClient
        .invoke('remote.status')
        .then((s) => alive && setStatus(s as RemoteStatus))
        .catch(() => {})
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (status) setPortDraft(String(status.port))
  }, [status?.port])

  const expiresIn = status?.pairing ? Math.max(0, Math.round((status.pairing.exp - now) / 1000)) : 0
  const expired = !!status?.pairing && expiresIn === 0
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }), [i18n.language])
  const ago = (ms?: number) => {
    if (!ms) return t('settings:mobile.never')
    const s = Math.round((ms - Date.now()) / 1000)
    if (s > -60) return t('settings:mobile.justNow')
    if (s > -3600) return rtf.format(Math.round(s / 60), 'minute')
    if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour')
    return rtf.format(Math.round(s / 86400), 'day')
  }

  const groups = useMemo(() => {
    const q = projectQuery.trim().toLowerCase()
    const list = (status?.trustedProjects ?? []).filter((p) => !q || p.toLowerCase().includes(q))
    return projectGroups(list, status?.projectInfo ?? {}, t('settings:mobile.temporaryChats'))
  }, [status?.trustedProjects, status?.projectInfo, projectQuery, t])

  if (!status) return <div className="text-[12.5px] text-foreground-secondary">{t('settings:mobile.loading')}</div>

  const statusLine = status.error
    ? t(status.error === 'port_in_use' ? 'settings:mobile.portInUse' : 'settings:mobile.startFailed', { port: status.port, error: status.error })
    : status.listening
      ? t('settings:mobile.listening', { port: status.port })
      : t('settings:mobile.off')

  const isOn = (p: string) => status.projects.some((x) => sameProject(x, p))
  const setGroupProjects = (paths: string[], on: boolean) => {
    const rest = status.projects.filter((x) => !paths.some((p) => sameProject(x, p)))
    void call('remote.setProjects', { projects: on ? [...rest, ...paths] : rest })
  }
  const toggleProject = (p: string, on: boolean) => {
    const next = on ? [...status.projects, p] : status.projects.filter((x) => !sameProject(x, p))
    void call('remote.setProjects', { projects: next })
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={t('settings:mobile.title')} description={t('settings:mobile.description')} />

      <SettingsSection title={t('settings:mobile.connection')}>
        <SettingRow label={t('settings:mobile.enable')} description={statusLine}>
          <Toggle on={status.enabled} disabled={busy} onChange={(v) => void call('remote.setEnabled', { enabled: v })} />
        </SettingRow>
        <SettingRow label={t('settings:mobile.port')} description={t('settings:mobile.portDesc')}>
          <input
            className={numberInputCls}
            inputMode="numeric"
            value={portDraft}
            aria-label={t('settings:mobile.port')}
            onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, ''))}
            onBlur={() => {
              const n = Number(portDraft)
              if (n !== status.port && n >= 1024 && n <= 65535) void call('remote.setPort', { port: n })
              else setPortDraft(String(status.port))
            }}
          />
        </SettingRow>
        <SettingRow label={t('settings:mobile.addresses')} description={status.endpoints.length ? undefined : t('settings:mobile.noAddress')}>
          <div className="flex flex-col items-end gap-0.5 font-mono text-[12px] text-foreground-secondary">
            {status.endpoints.map((e) => (
              <span key={e}>{e.replace(/^ws:\/\//, '')}</span>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      {status.listening && (
        <SettingsSection title={t('settings:mobile.pairing')} description={t('settings:mobile.pairingDesc')}>
          <div className="settings-row flex flex-wrap items-center gap-5">
            <div
              className={cn('h-[168px] w-[168px] shrink-0 rounded-md border border-border bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full', expired && 'opacity-25')}
              role="img"
              aria-label={t('settings:mobile.qrLabel')}
              // QR SVG is generated in the main process by the qrcode library from our own pairing link.
              dangerouslySetInnerHTML={{ __html: status.qrSvg ?? '' }}
            />
            <div className="flex min-w-0 flex-col gap-1.5 text-[12.5px] leading-[1.6] text-foreground-secondary">
              <span className="text-[13px] text-foreground">{t('settings:mobile.scanHint')}</span>
              <span className="tabular-nums">
                {status.pairing
                  ? expired
                    ? t('settings:mobile.expired')
                    : t('settings:mobile.expiresIn', { time: `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')}` })
                  : t('settings:mobile.noPairing')}
              </span>
              <span>{t('settings:mobile.oneTime')}</span>
              <div className="mt-1 flex gap-1">
                <button type="button" className={btnCompact} disabled={busy} onClick={() => void call('remote.regeneratePairing')}>
                  {t('settings:mobile.regenerate')}
                </button>
                {status.pairing && !expired && (
                  <button type="button" className={btnCompact} onClick={() => void navigator.clipboard.writeText(status.pairing!.link).catch(() => {})}>
                    {t('settings:mobile.copyLink')}
                  </button>
                )}
              </div>
              {status.hostKeyEphemeral && <span className="text-[12px] text-amber-700 dark:text-amber-300">{t('settings:mobile.ephemeralKey')}</span>}
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t('settings:mobile.devices')} description={status.devices.length ? undefined : t('settings:mobile.noDevices')}>
        {status.devices.map((d) => (
          <SettingRow
            key={d.id}
            label={d.name}
            description={
              d.revokedAt
                ? t('settings:mobile.revoked')
                : `${d.platform ? `${d.platform} · ` : ''}${d.online ? t('settings:mobile.online') : t('settings:mobile.lastSeen', { time: ago(d.lastSeenAt) })} · ${d.fingerprint}`
            }
          >
            <div className="flex items-center gap-1">
              {!d.revokedAt && (
                <select
                  className={cn(selectCls, 'min-w-0 py-1 text-[12px]')}
                  value={d.role}
                  aria-label={t('settings:mobile.role')}
                  onChange={(e) => void call('remote.setDeviceRole', { id: d.id, role: e.target.value })}
                >
                  <option value="operator">{t('settings:mobile.roleOperator')}</option>
                  <option value="viewer">{t('settings:mobile.roleViewer')}</option>
                </select>
              )}
              <button
                type="button"
                className={btnCompact}
                disabled={busy}
                onClick={() => void call(d.revokedAt ? 'remote.removeDevice' : 'remote.revokeDevice', { id: d.id })}
              >
                {d.revokedAt ? t('settings:mobile.forget') : t('settings:mobile.unpair')}
              </button>
            </div>
          </SettingRow>
        ))}
      </SettingsSection>

      <SettingsSection title={t('settings:mobile.projects')} description={t('settings:mobile.projectsDesc')}>
        {status.trustedProjects.length === 0 && <div className="settings-row text-[12.5px] text-foreground-secondary">{t('settings:mobile.noProjects')}</div>}
        {status.trustedProjects.length > 10 && (
          <div className="settings-row">
            <input
              className={cn(numberInputCls, 'w-full text-left')}
              placeholder={t('settings:mobile.projectSearch')}
              value={projectQuery}
              onChange={(e) => setProjectQuery(e.target.value)}
            />
          </div>
        )}
        {groups.map((g) => {
          const on = g.projects.filter((p) => isOn(p.path)).length
          // Temporary chats start folded: usually many, rarely what the phone should see.
          const open = projectQuery.trim() !== '' || (openGroups[g.key] ?? !g.temporary)
          return (
            <div key={g.key} className="settings-row block py-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-[12.5px] text-foreground-secondary hover:text-foreground"
                  onClick={() => setOpenGroups((m) => ({ ...m, [g.key]: !open }))}
                  title={g.label}
                >
                  <span className={cn('inline-block text-[10px] transition-transform', open && 'rotate-90')}>▸</span>
                  <span className={cn('truncate text-[12px]', !g.temporary && 'font-mono')}>{g.label}</span>
                  <span className="shrink-0 tabular-nums text-foreground-tertiary">
                    {on}/{g.projects.length}
                  </span>
                </button>
                <Toggle
                  on={on === g.projects.length}
                  disabled={busy}
                  onChange={(v) => setGroupProjects(g.projects.map((p) => p.path), v)}
                />
              </div>
              {open && (
                <div className="ml-4 mt-0.5 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {g.projects.map((p) => (
                    <label key={p.path} className="flex cursor-pointer items-center justify-between gap-3 py-1 text-[13px]" title={p.path}>
                      <span className="truncate">{p.name}</span>
                      <Toggle on={isOn(p.path)} disabled={busy} onChange={(v) => toggleProject(p.path, v)} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </SettingsSection>
    </div>
  )
}
