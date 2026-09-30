import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { EmptyState } from '@renderer/components/ui/empty-state'
import type { SidePanelComponentProps } from './side-panel-registry'

export function GenericAdapterSidePanel({ adapterId, panelComponent }: SidePanelComponentProps) {
  const { t } = useTranslation()
  const workspace = useUIStore((state) => state.currentWorkspace)
  const request = useRef(0)
  const [state, setState] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    const generation = ++request.current
    if (!workspace || !adapterId) { setState(null); return }
    setLoading(true)
    setError(null)
    try {
      const result = await ipcClient.invoke('adapter.sidePanel.getState', { adapterId, workspaceId: workspace })
      if (generation !== request.current) return
      if (!result?.ok) { setError(result?.error || 'read_failed'); setState(null) }
      else setState(result.state)
    } catch (failure) {
      if (generation === request.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (generation === request.current) setLoading(false)
    }
  }, [workspace, adapterId])
  useEffect(() => { void load(); return () => { request.current++ } }, [load])

  if (!workspace) return <EmptyState compact title={t('adapters:panel.openProject')} />
  if (!adapterId) return <EmptyState compact title={t('adapters:panel.unavailable')} />
  const items = Array.isArray((state as { items?: unknown[] } | null)?.items) ? (state as { items: unknown[] }).items : Array.isArray(state) ? state : []
  const json = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden" aria-busy={loading}>
      <div className="flex items-center justify-end border-b border-border/40 px-2">
        <button type="button" onClick={() => void load()} className="min-h-11 px-3 text-xs text-foreground-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" disabled={loading}>{t('adapters:panel.refresh')}</button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {loading ? <div className="space-y-3" role="status" aria-label={t('common:loading')}><div className="h-4 w-3/4 rounded bg-muted" /><div className="h-4 w-1/2 rounded bg-muted" /></div>
          : error ? <p role="alert" className="break-words text-xs text-destructive">{t(`adapters:panel.errors.${error}`, { defaultValue: t('adapters:panel.readFailed') })}</p>
          : panelComponent === 'list' ? items.length === 0 ? <EmptyState compact title={t('adapters:panel.empty')} /> : <ul className="divide-y divide-border/40">{items.map((item, index) => {
            const row: Record<string, unknown> = item && typeof item === 'object' ? item as Record<string, unknown> : { title: item }
            return <li key={index} className="py-3"><div className="break-words text-sm font-medium">{json(row.title ?? row.text ?? row.name ?? item)}</div>{row.description != null && <p className="mt-1 break-words text-xs text-muted-foreground">{json(row.description)}</p>}{row.status != null && <span className="mt-1 block text-xs text-muted-foreground">{json(row.status)}</span>}</li>
          })}</ul>
          : panelComponent === 'tree' ? <JsonTree value={state} />
          : <pre className="whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(state, null, 2)}</pre>}
      </div>
    </section>
  )
}

function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (!value || typeof value !== 'object' || depth >= 12) return <span className="break-words text-xs">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
  return <div className="space-y-1">{Object.entries(value).slice(0, 100).map(([key, child]) => <details key={key} open={depth < 1} className="pl-3"><summary className="min-h-6 cursor-pointer text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{key}</summary><JsonTree value={child} depth={depth + 1} /></details>)}</div>
}
