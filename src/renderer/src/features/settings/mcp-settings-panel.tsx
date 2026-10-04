import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { SettingsPageHeader } from './settings-shell'
import { SettingRow, SettingsSection, Toggle } from './settings-page-shared'
import { btnCompact, btnOutline, btnPrimary, inputCls, selectCls, textareaCls } from './settings-controls'
import { MCP_EXPOSURES, type McpExposure, type McpForm, describeTransport, emptyForm, fromForm, toForm } from './mcp-form'

type Config = Record<string, unknown>
type Row = { name: string; scope: 'global' | 'project'; config: Config; override?: Config; source: string }
type View = {
  ok: boolean
  error?: string
  project: string | null
  projectTrusted: boolean
  projectPath: string | null
  globalPath: string
  servers: Row[]
  autoEnableCodemode: boolean
  errors: string[]
}
type Status = { name: string; state: string; tools: string[]; error?: string; enabled: boolean }
type Editing = { previousName?: string; scope: 'global' | 'project'; form: McpForm; base: Config }

const small = 'h-7 py-0 text-[12px]'
const STATE_DOT: Record<string, string> = {
  connected: 'bg-emerald-500/80',
  'needs-auth': 'bg-amber-500/80',
  failed: 'bg-red-500/75',
  disconnected: 'bg-red-500/75',
  connecting: 'bg-foreground/30',
}

export function McpSettingsPanel() {
  const { t } = useTranslation()
  const [view, setView] = useState<View | null>(null)
  const [status, setStatus] = useState<Record<string, Status> | null>(null)
  const [checking, setChecking] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [importing, setImporting] = useState<{ text: string; scope: 'global' | 'project'; result?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = (await ipcClient.invoke('mcp.config.get')) as View
    setView(res)
    return res
  }, [])

  const refreshStatus = useCallback(async () => {
    setChecking(true)
    try {
      const res = (await ipcClient.invoke('mcp.status')) as { ok: boolean; servers?: Status[]; error?: string }
      if (res.ok) setStatus(Object.fromEntries((res.servers ?? []).map((s) => [s.name, s])))
      else setMessage(res.error ?? null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void load().then((v) => {
      if (v.ok && v.servers.length) void refreshStatus()
    })
  }, [load, refreshStatus])

  const run = async (key: string, call: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(key)
    setMessage(null)
    try {
      const res = await call()
      if (!res.ok) setMessage(res.error ?? 'error')
      else after?.()
      await load()
    } finally {
      setBusy(null)
    }
  }

  const patch = (row: Row, body: Record<string, unknown>, target: 'global' | 'project' | 'override' = row.scope) =>
    run(`patch:${row.name}`, () => ipcClient.invoke('mcp.server.patch', { name: row.name, target, ...body }))

  const save = () => {
    if (!editing) return
    const config = fromForm(editing.form, editing.base)
    void run(
      'save',
      () => ipcClient.invoke('mcp.server.save', { scope: editing.scope, name: editing.form.name.trim(), config, previousName: editing.previousName }),
      () => {
        setEditing(null)
        void refreshStatus()
      },
    )
  }

  if (view && !view.ok) {
    return (
      <div className="space-y-6">
        <SettingsPageHeader title={t('settings:mcp.title')} description={t('settings:mcp.description')} />
        <p className="text-[12.5px] text-foreground-secondary">
          {view.error === 'MCP_WSL_UNSUPPORTED' ? t('settings:mcp.wslUnsupported') : view.error}
        </p>
      </div>
    )
  }

  const servers = view?.servers ?? []
  return (
    <div className="space-y-8" data-mcp-settings="">
      <SettingsPageHeader
        title={t('settings:mcp.title')}
        description={t('settings:mcp.description')}
        action={
          <div className="flex items-center gap-1.5">
            <button type="button" className={btnCompact} disabled={checking || !servers.length} onClick={() => void refreshStatus()}>
              {checking ? t('settings:mcp.checking') : t('settings:mcp.checkStatus')}
            </button>
            <button type="button" className={btnCompact} onClick={() => setImporting({ text: '', scope: 'global' })}>
              {t('settings:mcp.import')}
            </button>
            <button
              type="button"
              className={btnOutline}
              onClick={() => setEditing({ scope: 'global', form: emptyForm(), base: {} })}
            >
              {t('settings:mcp.add')}
            </button>
          </div>
        }
      />

      {message ? <p className="-mt-4 text-[12px] text-red-600/90 dark:text-red-400/90">{message}</p> : null}
      {view?.errors.length ? <p className="-mt-4 text-[12px] text-red-600/90 dark:text-red-400/90">{view.errors.join('\n')}</p> : null}

      {importing ? (
        <SettingsSection title={t('settings:mcp.importTitle')} description={t('settings:mcp.importDesc')}>
          <div className="space-y-2 px-4 py-3">
            <textarea
              aria-label={t('settings:mcp.importTitle')}
              className={cn(textareaCls, 'h-36 text-[12px]')}
              placeholder={'{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "…"] } } }'}
              value={importing.text}
              onChange={(e) => setImporting({ ...importing, text: e.target.value })}
            />
            <div className="flex items-center justify-between gap-2">
              <ScopeSelect value={importing.scope} project={view?.project ?? null} onChange={(scope) => setImporting({ ...importing, scope })} />
              <div className="flex gap-1.5">
                <button type="button" className={btnCompact} onClick={() => setImporting(null)}>
                  {t('common:cancel')}
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!importing.text.trim() || busy === 'import'}
                  onClick={() =>
                    void run('import', async () => {
                      const res = (await ipcClient.invoke('mcp.import', { scope: importing.scope, text: importing.text })) as {
                        ok: boolean
                        error?: string
                        added?: string[]
                        problems?: string[]
                      }
                      if (res.ok) {
                        const lines = [t('settings:mcp.imported', { count: res.added?.length ?? 0 }), ...(res.problems ?? [])]
                        setImporting({ ...importing, result: lines.join('\n') })
                        if (res.added?.length) void refreshStatus()
                      }
                      return res
                    })
                  }
                >
                  {t('settings:mcp.importRun')}
                </button>
              </div>
            </div>
            {importing.result ? <pre className="whitespace-pre-wrap text-[11.5px] text-foreground-secondary">{importing.result}</pre> : null}
          </div>
        </SettingsSection>
      ) : null}

      {editing && editing.previousName === undefined ? (
        <SettingsSection title={t('settings:mcp.addTitle')}>
          <ServerEditor editing={editing} project={view?.project ?? null} onChange={setEditing} onCancel={() => setEditing(null)} onSave={save} saving={busy === 'save'} />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t('settings:mcp.servers')} description={view && !view.projectTrusted && view.project ? t('settings:mcp.projectUntrusted') : undefined}>
        {servers.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-foreground-secondary">{view ? t('settings:mcp.empty') : t('common:loading')}</p>
        ) : (
          servers.map((row) =>
            editing?.previousName === row.name ? (
              <div key={row.name} className="settings-row">
                <ServerEditor editing={editing} project={view?.project ?? null} onChange={setEditing} onCancel={() => setEditing(null)} onSave={save} saving={busy === 'save'} />
              </div>
            ) : (
              <ServerRow
                key={`${row.scope}:${row.name}`}
                row={row}
                status={status?.[row.name]}
                checking={checking}
                projectTrusted={!!view?.projectTrusted}
                busy={busy}
                onPatch={patch}
                onEdit={() => setEditing({ previousName: row.name, scope: row.scope, form: toForm(row.name, row.config), base: row.scope === 'global' ? stripOverride(row) : row.config })}
                onRemove={() => {
                  if (window.confirm(t('settings:mcp.removeConfirm', { name: row.name }))) {
                    void run(`remove:${row.name}`, () => ipcClient.invoke('mcp.server.remove', { scope: row.scope, name: row.name }))
                  }
                }}
                onLogin={(logout) =>
                  void run(logout ? `logout:${row.name}` : `login:${row.name}`, () => ipcClient.invoke(logout ? 'mcp.logout' : 'mcp.login', { name: row.name }), () =>
                    void refreshStatus(),
                  )
                }
              />
            ),
          )
        )}
      </SettingsSection>

      <SettingsSection title={t('settings:mcp.options')}>
        <SettingRow label={t('settings:mcp.autoCodemode')} description={t('settings:mcp.autoCodemodeDesc')} settingKey="autoEnableCodemode">
          <Toggle
            on={view?.autoEnableCodemode !== false}
            disabled={!view}
            onChange={(v) => void run('auto', () => ipcClient.invoke('mcp.autoCodemode.set', { value: v }))}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  )
}

/** A global server's own config: the effective one minus what the project override set. */
function stripOverride(row: Row): Config {
  if (!row.override) return row.config
  const out = { ...row.config }
  for (const key of Object.keys(row.override)) delete out[key]
  return out
}

function ScopeSelect({ value, project, onChange }: { value: 'global' | 'project'; project: string | null; onChange: (v: 'global' | 'project') => void }) {
  const { t } = useTranslation()
  return (
    <select aria-label={t('settings:mcp.scope')} className={cn(selectCls, small, 'min-w-[8rem]')} value={value} onChange={(e) => onChange(e.target.value as 'global' | 'project')}>
      <option value="global">{t('settings:mcp.scopeGlobal')}</option>
      {project ? <option value="project">{t('settings:mcp.scopeProject')}</option> : null}
    </select>
  )
}

function ServerRow({
  row,
  status,
  checking,
  projectTrusted,
  busy,
  onPatch,
  onEdit,
  onRemove,
  onLogin,
}: {
  row: Row
  status?: Status
  checking: boolean
  projectTrusted: boolean
  busy: string | null
  onPatch: (row: Row, body: Record<string, unknown>, target?: 'global' | 'project' | 'override') => void
  onEdit: () => void
  onRemove: () => void
  onLogin: (logout: boolean) => void
}) {
  const { t } = useTranslation()
  const enabled = row.config.enabled !== false
  const exposure = (row.config.exposure as McpExposure | undefined) ?? 'codemode'
  const isHttp = typeof row.config.url === 'string'
  const state = !enabled ? 'disabled' : (status?.state ?? (checking ? 'connecting' : 'unknown'))
  const overrideEnabled = row.override && typeof row.override.enabled === 'boolean' ? (row.override.enabled ? 'on' : 'off') : 'inherit'
  const meta = [
    row.scope === 'global' ? t('settings:mcp.scopeGlobal') : t('settings:mcp.scopeProject'),
    status && enabled ? t('settings:mcp.toolCount', { count: status.tools.length }) : '',
    state !== 'unknown' ? t(`settings:mcp.state.${state}`, { defaultValue: state }) : '',
  ].filter(Boolean)
  return (
    <div className="settings-row flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-mcp-server={row.name} data-state={state}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATE_DOT[state] ?? 'bg-foreground/15')} />
          <span className="font-mono text-[13px] text-foreground">{row.name}</span>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground/70">{describeTransport(row.config)}</span>
        </div>
        <div className="mt-0.5 pl-3.5 text-[11.5px] text-foreground-secondary">{meta.join(' · ')}</div>
        {status?.error && enabled ? <div className="mt-0.5 pl-3.5 text-[11.5px] text-red-600/85 dark:text-red-400/85">{status.error}</div> : null}
        <div className="mt-1 flex flex-wrap gap-0.5 pl-2">
          <button type="button" className={btnCompact} onClick={onEdit}>
            {t('settings:mcp.edit')}
          </button>
          {isHttp ? (
            <>
              <button type="button" className={btnCompact} disabled={busy === `login:${row.name}`} onClick={() => onLogin(false)}>
                {busy === `login:${row.name}` ? t('settings:mcp.signingIn') : t('settings:mcp.signIn')}
              </button>
              <button type="button" className={btnCompact} onClick={() => onLogin(true)}>
                {t('settings:mcp.signOut')}
              </button>
            </>
          ) : null}
          <button type="button" className={cn(btnCompact, 'hover:text-destructive')} onClick={onRemove}>
            {t('settings:mcp.remove')}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:ml-6">
        {row.scope === 'global' && projectTrusted ? (
          <select
            aria-label={t('settings:mcp.inProject')}
            title={t('settings:mcp.inProject')}
            className={cn(selectCls, small, 'min-w-[7.5rem]')}
            value={overrideEnabled}
            onChange={(e) => onPatch(row, { enabled: e.target.value === 'inherit' ? null : e.target.value === 'on' }, 'override')}
          >
            <option value="inherit">{t('settings:mcp.projectInherit')}</option>
            <option value="on">{t('settings:mcp.projectOn')}</option>
            <option value="off">{t('settings:mcp.projectOff')}</option>
          </select>
        ) : null}
        <select
          aria-label={t('settings:mcp.exposure')}
          title={t(`settings:mcp.exposureDesc.${exposure}`)}
          className={cn(selectCls, small, 'min-w-[7rem]')}
          value={exposure}
          onChange={(e) => onPatch(row, { exposure: e.target.value }, row.override ? 'override' : row.scope)}
        >
          {MCP_EXPOSURES.map((x) => (
            <option key={x} value={x}>
              {t(`settings:mcp.exposures.${x}`)}
            </option>
          ))}
        </select>
        <Toggle on={enabled} disabled={busy === `patch:${row.name}`} onChange={(v) => onPatch(row, { enabled: v }, row.override ? 'override' : row.scope)} />
      </div>
    </div>
  )
}

function ServerEditor({
  editing,
  project,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  editing: Editing
  project: string | null
  onChange: (next: Editing) => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const f = editing.form
  const set = (patch: Partial<McpForm>) => onChange({ ...editing, form: { ...f, ...patch } })
  const field = (label: string, node: React.ReactNode, wide = false) => (
    <label className={cn('flex flex-col gap-1 text-[11.5px] text-muted-foreground', wide && 'sm:col-span-2')}>
      {label}
      {node}
    </label>
  )
  const valid = /^[A-Za-z0-9_-]+$/.test(f.name.trim()) && (f.kind === 'stdio' ? f.command.trim() : /^https?:\/\//i.test(f.url.trim()))
  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-2" data-mcp-editor="">
      {field(t('settings:mcp.name'), <input className={cn(inputCls, small)} value={f.name} placeholder="github" onChange={(e) => set({ name: e.target.value })} />)}
      <div className="flex items-end gap-2">
        <div role="radiogroup" aria-label={t('settings:mcp.transport')} className="flex gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5">
          {(['stdio', 'http'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={f.kind === k}
              onClick={() => set({ kind: k })}
              className={cn('rounded-[5px] px-2.5 py-0.5 text-[11.5px] text-muted-foreground', f.kind === k && 'bg-background text-foreground shadow-[0_0_0_0.5px_var(--border)]')}
            >
              {t(`settings:mcp.kind.${k}`)}
            </button>
          ))}
        </div>
        {editing.previousName === undefined ? <ScopeSelect value={editing.scope} project={project} onChange={(scope) => onChange({ ...editing, scope })} /> : null}
      </div>
      {f.kind === 'stdio' ? (
        <>
          {field(t('settings:mcp.command'), <input className={cn(inputCls, small)} value={f.command} placeholder="npx" onChange={(e) => set({ command: e.target.value })} />)}
          {field(t('settings:mcp.cwd'), <input className={cn(inputCls, small)} value={f.cwd} placeholder="." onChange={(e) => set({ cwd: e.target.value })} />)}
          {field(t('settings:mcp.args'), <textarea className={cn(textareaCls, 'h-20 text-[12px]')} value={f.args} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n.'} onChange={(e) => set({ args: e.target.value })} />)}
          {field(t('settings:mcp.env'), <textarea className={cn(textareaCls, 'h-20 text-[12px]')} value={f.env} placeholder="GITHUB_TOKEN=${GITHUB_TOKEN}" onChange={(e) => set({ env: e.target.value })} />)}
        </>
      ) : (
        <>
          {field(t('settings:mcp.url'), <input className={cn(inputCls, small)} value={f.url} placeholder="https://example.com/mcp" onChange={(e) => set({ url: e.target.value })} />, true)}
          {field(t('settings:mcp.headers'), <textarea className={cn(textareaCls, 'h-16 text-[12px]')} value={f.headers} placeholder="Authorization: Bearer ${TOKEN}" onChange={(e) => set({ headers: e.target.value })} />, true)}
        </>
      )}
      {field(t('settings:mcp.serverDescription'), <input className={cn(inputCls, small, 'font-sans')} value={f.description} placeholder={t('settings:mcp.serverDescriptionPlaceholder')} onChange={(e) => set({ description: e.target.value })} />, true)}
      <div className="flex items-end gap-3">
        {field(
          t('settings:mcp.exposure'),
          <select className={cn(selectCls, small)} value={f.exposure} onChange={(e) => set({ exposure: e.target.value as McpExposure })}>
            {MCP_EXPOSURES.map((x) => (
              <option key={x} value={x}>
                {t(`settings:mcp.exposures.${x}`)}
              </option>
            ))}
          </select>,
        )}
        {field(t('settings:mcp.timeout'), <input className={cn(inputCls, small, 'w-20 text-right')} inputMode="numeric" value={f.timeout} placeholder="60" onChange={(e) => set({ timeout: e.target.value })} />)}
      </div>
      <p className="self-end text-[11px] leading-4 text-muted-foreground/70">{t(`settings:mcp.exposureDesc.${f.exposure}`)}</p>
      <div className="flex justify-end gap-1.5 sm:col-span-2">
        <button type="button" className={btnCompact} onClick={onCancel}>
          {t('common:cancel')}
        </button>
        <button type="button" className={btnPrimary} disabled={!valid || saving} onClick={onSave}>
          {t('common:save')}
        </button>
      </div>
    </div>
  )
}
