// Adapter primitive registry & schema-driven config form (兼容层 v2 renderer side)
// 见 doc/adapter-layer-plan.md §4.1
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { RefreshCw, Plug } from '@renderer/components/icons'
import type { AdapterJson, ConfigField, DerivedRow } from '@extension-compat/adapter-schema'
import { resolveAdapterText } from '@extension-compat/adapter-schema'

// Template resolver: ${field} + simple ternary ${cond?true:false}
export function evalTpl(tplStr: string | undefined, view: Record<string, unknown>): string {
  if (!tplStr) return ''
  return tplStr.replace(/\$\{(\w+)\??([^}]*)\}/g, (_m, key, rest) => {
    const v = view[key]
    if (rest && rest.startsWith(':')) {
      const [yes, no] = rest.slice(1).split(':')
      return v ? yes : no
    }
    return v != null ? String(v) : ''
  })
}

function FieldRow({ field, value, isSet, adapterId, onChange }: { field: ConfigField; value: unknown; isSet?: boolean; adapterId: string; onChange: (v: unknown) => void }) {
  const { t } = useTranslation()
  const label = field.label || field.key
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center justify-between py-2">
        <span className="text-[12px] text-foreground/85">{label}</span>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors',
            value === true ? 'bg-primary' : 'bg-muted-foreground/20 dark:bg-[var(--bg-3)]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all',
              'dark:bg-[var(--text-primary)]',
              value === true && 'dark:bg-[hsl(var(--primary-foreground))]',
              value === true ? 'left-4' : 'left-0.5',
            )}
          />
        </button>
      </label>
    )
  }
  if (field.type === 'select') {
    return <SelectField field={field} value={value} adapterId={adapterId} onChange={onChange} />
  }
  if (field.type === 'secret') {
    const set = !!isSet
    return (
      <label className="block py-2">
        <span className="text-[10px] text-muted-foreground/70">{label}</span>
        <input
          type="password"
          autoComplete="off"
          placeholder={set ? `${t('extension:configured')} ${(value as string) || ''}` : t('extension:notConfigured')}
          className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px]"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    )
  }
  return (
    <label className="block py-2">
      <span className="text-[10px] text-muted-foreground/70">{label}</span>
      <input
        className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] font-mono"
        value={String(value ?? '')}
        onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </label>
  )
}

function SelectField({ field, value, adapterId, onChange }: { field: ConfigField; value: unknown; adapterId: string; onChange: (v: unknown) => void }) {
  const workspaceId = useUIStore((state) => state.currentWorkspace) || ''
  const { t } = useTranslation()
  const label = field.label || field.key
  const isDynamic = !!field.optionsFrom
  const [dynamicOpts, setDynamicOpts] = useState<string[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const generation = useRef(0)

  const fetchOpts = useCallback(async () => {
    const request = ++generation.current
    setFetching(true)
    setHint(null)
    try {
      const r = await ipcClient.invoke('adapter.field.options', { adapterId, fieldKey: field.key, workspaceId })
      if (request !== generation.current) return
      if (r?.error) setHint(r.error)
      setDynamicOpts(Array.isArray(r?.options) ? r.options : [])
    } catch (e: unknown) {
      if (request === generation.current) setHint(e instanceof Error ? e.message : String(e))
    } finally {
      if (request === generation.current) setFetching(false)
    }
  }, [adapterId, field.key, workspaceId])

  useEffect(() => {
    setDynamicOpts(null)
    setHint(null)
    if (isDynamic) void fetchOpts()
    return () => { generation.current++ }
  }, [isDynamic, fetchOpts])

  const options = isDynamic ? (dynamicOpts || []) : (field.options || [])
  const currentVal = String(value ?? '')
  const currentInList = options.includes(currentVal)

  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/70">{label}</span>
        {isDynamic && (
          <button
            type="button"
            onClick={fetchOpts}
            disabled={fetching}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-40"
            title={t('extension:fetchList')}
          >
            <RefreshCw className={cn('h-3 w-3', fetching && 'animate-spin')} />
            {fetching ? t('extension:fetching') : t('extension:refreshList')}
          </button>
        )}
      </div>
      <select
        className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px]"
        value={currentVal}
        onChange={(e) => onChange(e.target.value)}
      >
        {!currentInList && currentVal && <option value={currentVal}>{currentVal}（{t('extension:current')}）</option>}
        {!currentVal && <option value="">{t('extension:selectPlaceholder')}</option>}
        {isDynamic && options.length === 0 && !fetching && <option value="" disabled>{t('extension:clickToFetch')}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {hint && <div className="mt-0.5 text-[10px] text-destructive/70">{hint}</div>}
    </div>
  )
}

function StatusGrid({ rows, view }: { rows: DerivedRow[]; view: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const available = evalTpl(r.available, view) === 'true'
        return (
          <div
            key={r.label}
            className={cn(
              'flex items-center justify-between rounded-md border px-2 py-1 text-[11px]',
              available ? 'border-green-500/30 bg-green-500/5' : 'border-border/50 bg-muted/20',
            )}
          >
            <span className="font-mono">{r.label}</span>
            <span className="text-muted-foreground">{evalTpl(r.detail, view)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Generic schema-driven adapter config panel. Replaces per-plugin config components. */
export function AdapterConfigPanel({ adapter }: { adapter: AdapterJson }) {
  const { t, i18n } = useTranslation()
  const workspaceId = useUIStore((state) => state.currentWorkspace) || ''
  const generation = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const cfg = adapter.config
  const resolved = useMemo(() => resolveAdapterText(adapter, i18n.language), [adapter, i18n.language])
  const [view, setView] = useState<Record<string, unknown>>({})
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [actionResult, setActionResult] = useState<Record<string, { ok: boolean; lines?: string[]; error?: string }>>({})

  const load = useCallback(() => {
    const request = ++generation.current
    setLoading(true)
    setSaving(false)
    setActionResult({})
    setError(null)
    ipcClient.invoke('adapter.config.get', { adapterId: adapter.id, workspaceId })
      .then((r) => {
        if (request !== generation.current) return
        const v = (r?.view || {}) as Record<string, unknown>
        setView(v)
        setDraft(v)
      })
      .catch((failure: unknown) => { if (request === generation.current) setError(failure instanceof Error ? failure.message : String(failure)) })
      .finally(() => { if (request === generation.current) setLoading(false) })
  }, [adapter.id, workspaceId])

  useEffect(() => { load(); return () => { generation.current++ } }, [load])

  const save = async () => {
    const request = generation.current
    setSaving(true)
    try {
      const r = await ipcClient.invoke('adapter.config.set', { adapterId: adapter.id, patch: Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== view[key])), workspaceId })
      if (request !== generation.current) return
      const v = (r?.view || {}) as Record<string, unknown>
      setView(v)
      setDraft(v)
    } catch (e) {
      if (request === generation.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (request === generation.current) setSaving(false)
    }
  }

  const runAction = async (actionId: string) => {
    const request = generation.current
    setActionResult((p) => ({ ...p, [actionId]: { ok: true, lines: [t('extension:executing')] } }))
    try {
      const r = await ipcClient.invoke('adapter.action.run', { adapterId: adapter.id, actionId, workspaceId })
      if (request === generation.current) setActionResult((p) => ({ ...p, [actionId]: r }))
    } catch (e: unknown) {
      if (request === generation.current) setActionResult((p) => ({ ...p, [actionId]: { ok: false, error: e instanceof Error ? e.message : String(e) } }))
    }
  }

  if (loading) return <div className="text-[12px] text-muted-foreground/50">{t('extension:loading', { name: resolved.displayName || adapter.id })}</div>

  if (!cfg || (!cfg.sections?.length && !cfg.actions?.length)) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
        <div className="text-[12px] font-medium text-foreground/80">{adapter.displayName || adapter.id}</div>
        <div className="mt-1 text-[11px] text-muted-foreground/60">{resolved.note || t('extension:noConfig')}</div>
      </div>
    )
  }

  const fields = (cfg.sections || []).flatMap((s) => s.fields || [])

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-[12px] text-destructive">{error}</p>}
      {view.__configFileError === 'invalid_json' && <p role="alert" className="text-[12px] text-destructive">{t('extension:invalidConfig')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] hover:bg-accent">
          <RefreshCw className="h-3 w-3" /> {t('extension:refresh')}
        </button>
        {cfg.actions?.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => runAction(a.id)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] hover:bg-accent"
          >
            <Plug className="h-3 w-3" /> {resolved.actions.find((ra) => ra.id === a.id)?.label || a.label || a.id}
          </button>
        ))}
        <button
          type="button"
          onClick={save}
          disabled={saving || !!view.__configFileError}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground transition-all duration-motion-fast ease-motion-ease hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
        >
          {saving ? t('extension:saving') : t('extension:save')}
        </button>
      </div>

      {cfg.configFile && (
        <p className="font-mono text-[10px] break-all text-muted-foreground/60">{String(cfg.configFile)}</p>
      )}

      {resolved.sections.map((sec, i) => (
        <div key={i} className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-1">
          {sec.title && <div className="text-[11px] font-medium text-foreground/85">{sec.title}</div>}
          {sec.fields?.map((f) => (
            <FieldRow
              key={f.key}
              field={f}
              value={draft[f.key]}
              isSet={!!view[`${f.key}Set`]}
              adapterId={adapter.id}
              onChange={(v) => setDraft((p) => ({ ...p, [f.key]: v }))}
            />
          ))}
          {cfg.sections?.[i]?.derived && cfg.sections[i].derived!.length > 0 && <StatusGrid rows={cfg.sections[i].derived!} view={view} />}
        </div>
      ))}

      {resolved.note && <p className="text-[11px] text-muted-foreground/70">{resolved.note}</p>}

      {Object.entries(actionResult).map(([id, r]) => (
        r.error ? <p key={id} role="alert" className="text-[12px] text-destructive">{r.error}</p> : r.lines && r.lines.length > 0 && (
          <pre key={id} className="max-h-48 overflow-auto rounded-lg border border-border/50 bg-muted/20 p-2 text-[10px] whitespace-pre-wrap">
            {r.lines.join('\n')}
          </pre>
        )
      ))}
    </div>
  )
}
