// Model picker panel: models grouped by provider (sorted), collapsed by default.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { X, Search, Check, Cpu, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { formatModelFull } from '@renderer/lib/format-run-display'

type ModelRow = { id: string; provider: string; name?: string; available?: boolean }

function groupByProvider(models: ModelRow[]): { provider: string; models: ModelRow[] }[] {
  const map = new Map<string, ModelRow[]>()
  for (const m of models) {
    const p = m.provider || 'unknown'
    const list = map.get(p)
    if (list) list.push(m)
    else map.set(p, [m])
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, rows]) => ({
      provider,
      models: rows.sort((x, y) => x.id.localeCompare(y.id)),
    }))
}

export function ModelPicker() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.modelPickerOpen)
  const setOpen = useUIStore((s) => s.setModelPickerOpen)
  const currentModel = useUIStore((s) => s.runState.model)
  const [models, setModels] = useState<ModelRow[]>([])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!open) return
    setQuery('')
    setExpanded({})
    ipcClient.invoke('model.list').then((res) => setModels(res?.models || [])).catch(() => {})
  }, [open])

  const filtered = useMemo(() => {
    if (!query) return models
    const q = query.toLowerCase()
    return models.filter(
      (m) =>
        `${m.provider}/${m.id}`.toLowerCase().includes(q) ||
        (m.name || '').toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    )
  }, [models, query])

  const groups = useMemo(() => groupByProvider(filtered), [filtered])

  const searching = query.trim().length > 0

  const pick = async (m: ModelRow) => {
    const key = `${m.provider}/${m.id}`
    try {
      await ipcClient.invoke('model.set', { sessionId: '', provider: m.provider, modelId: m.id })
      useUIStore.getState().setRunState({ model: key })
      toast.success(t('composer:switchedModel', { key }))
    } catch (e) {
      console.error('model.set failed:', e)
      toast.error(t('composer:switchFailed'))
    }
    setOpen(false)
  }

  const toggleProvider = (provider: string) => {
    setExpanded((prev) => ({ ...prev, [provider]: !prev[provider] }))
  }

  const isProviderOpen = (provider: string) => {
    if (searching) return true
    return !!expanded[provider]
  }

  if (!open) return null

  return (
    <div
      className="picker-backdrop backdrop-motion fixed inset-0 z-[110] flex items-end justify-center bg-black/40 p-4 pb-28 sm:items-start sm:pt-20"
      onClick={() => setOpen(false)}
    >
      <div
        className="picker-panel w-full max-w-lg overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl"
        style={{ boxShadow: '0 16px 48px color-mix(in srgb, var(--foreground) 12%, transparent)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground/70" />
            <div>
              <div className="text-[14px] font-medium">{t('composer:selectModelTitle')}</div>
              <div className="text-[11px] text-muted-foreground">
                {t('composer:current')}
                <span className="font-mono">{formatModelFull(currentModel)}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="row-hover rounded-lg p-1.5 text-foreground-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('composer:searchModelPlaceholder')}
              className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground/50">
              {models.length === 0 ? t('composer:noModels') : t('composer:noMatch')}
            </div>
          )}
          {groups.map(({ provider, models: rows }) => {
            const openGroup = isProviderOpen(provider)
            const activeInGroup = rows.some((m) => currentModel === `${m.provider}/${m.id}`)
            return (
              <div key={provider} className="model-picker-provider border-b border-border/30 last:border-b-0">
                <button
                  type="button"
                  className="model-picker-provider-header interactive-row flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  onClick={() => toggleProvider(provider)}
                  aria-expanded={openGroup}
                >
                  <ChevronRight
                    className="settings-chevron h-4 w-4 shrink-0 text-muted-foreground"
                    data-open={openGroup}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold">{provider}</span>
                  <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                    {t('composer:providerModelCount', { count: rows.length })}
                  </span>
                  {activeInGroup && !openGroup && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  )}
                </button>
                <div className="settings-expand-grid" data-open={openGroup}>
                  <div className="settings-expand-inner">
                    <div className="settings-expand-content pb-0.5">
                      {rows.map((m) => {
                        const key = `${m.provider}/${m.id}`
                        const active = currentModel === key
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => pick(m)}
                            className={cn(
                              'picker-row flex w-full items-center gap-2.5 py-2 pl-9 pr-4 text-left',
                              active && 'bg-[var(--bg-active)]',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[12px] font-medium">{m.id}</span>
                                {!m.available && (
                                  <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                                    {t('composer:unavailable')}
                                  </span>
                                )}
                              </div>
                              {m.name && m.name !== m.id && (
                                <div className="truncate text-[11px] text-muted-foreground/60">{m.name}</div>
                              )}
                            </div>
                            {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-muted-foreground/60">
          <span>{t('composer:modelCount', { total: models.length, shown: filtered.length })}</span>
          <span>{t('composer:escToClose')}</span>
        </div>
      </div>
    </div>
  )
}