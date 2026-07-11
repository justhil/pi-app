import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { RefreshCw, ChevronDown, ChevronRight, Layers, MessageSquare } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { formatTokens, estTokensFromChars } from '@renderer/lib/format-tokens'

type Segment = {
  index: number
  role: string
  chars: number
  preview: string
  label?: string
}

type ContextPreview = {
  messageCount: number
  estimatedChars: number
  snippets?: string[]
  segments?: Segment[]
}

const ROLE_STYLE: Record<string, { bar: string; badge: string; labelKey: string }> = {
  user: { bar: 'bg-blue-500/70', badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', labelKey: 'context:userLabel' },
  assistant: { bar: 'bg-brand/80', badge: 'bg-brand/15 text-foreground', labelKey: 'context:assistantLabel' },
  toolResult: { bar: 'bg-amber-500/70', badge: 'bg-amber-500/15 text-amber-800 dark:text-amber-200', labelKey: 'context:toolResultLabel' },
  compactionSummary: { bar: 'bg-purple-500/60', badge: 'bg-purple-500/15 text-purple-800 dark:text-purple-200', labelKey: 'context:compactionLabel' },
  branchSummary: { bar: 'bg-purple-500/50', badge: 'bg-purple-500/10 text-purple-700', labelKey: 'context:branchLabel' },
  system: { bar: 'bg-[var(--aou-6)]/80', badge: 'bg-[var(--aou-6)]/15 text-[var(--aou-8)] dark:text-[var(--aou-4)]', labelKey: 'context:systemLabel' },
}

function roleMeta(role: string) {
  return (
    ROLE_STYLE[role] || {
      bar: 'bg-foreground-secondary/40',
      badge: 'bg-muted text-foreground-secondary',
      labelKey: '',
    }
  )
}

export function ContextPanel() {
  const { t } = useTranslation()
  const workspace = useUIStore((s) => s.currentWorkspace)
  const model = useUIStore((s) => s.runState.model)
  const [preview, setPreview] = useState<ContextPreview | null>(null)
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())

  const load = () => {
    if (!workspace) return
    setLoading(true)
    ipcClient
      .invoke('context.preview')
      .then((r) => setPreview(r?.preview || null))
      .catch(() => setPreview(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // Context panel is only mounted while active; one-shot load on open / workspace change.
    // Manual refresh remains available via the panel button; no idle polling.
    load()
  }, [workspace])

  useEffect(() => {
    if (!workspace || !model) {
      setContextWindow(null)
      return
    }
    ipcClient
      .invoke('model.list', {})
      .then((r) => {
        const models = (r?.models || []) as { id: string; name: string; contextWindow?: number }[]
        const m =
          models.find((x) => x.id === model || x.name === model) ||
          models.find((x) => model.includes(x.id))
        setContextWindow(m?.contextWindow && m.contextWindow > 0 ? m.contextWindow : null)
      })
      .catch(() => setContextWindow(null))
  }, [workspace, model])

  const estTokens = preview ? estTokensFromChars(preview.estimatedChars) : null
  const ctxPct =
    estTokens != null && contextWindow != null && contextWindow > 0
      ? Math.min(100, (estTokens / contextWindow) * 100)
      : null

  const segments = preview?.segments || []
  const maxChars = useMemo(() => Math.max(1, ...segments.map((s) => s.chars)), [segments])

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  if (!workspace) {
    return (
      <div className="p-4 text-[13px] leading-relaxed text-foreground-secondary">
        {t('context:openProjectHint')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-foreground-secondary/70" />
          <span className="text-[13px] font-semibold text-foreground">{t('context:title')}</span>
        </div>
        <button type="button" onClick={load} className="chrome-icon-btn rounded-md p-1.5" title={t('context:refresh')}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {!preview ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <MessageSquare className="h-8 w-8 text-foreground-secondary/25" />
          <p className="text-[13px] leading-relaxed text-foreground-secondary/80">
            {t('context:workerNotReady')}
          </p>
        </div>
      ) : (
        <>
          <div className="shrink-0 space-y-2 border-b border-border/40 px-3 py-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border/50 bg-[var(--bg-2)]/50 px-2.5 py-2">
                <div className="text-[11px] text-foreground-secondary/80">{t('context:messageCount')}</div>
                <div className="text-[16px] font-semibold tabular-nums text-foreground">{preview.messageCount}</div>
              </div>
              <div className="rounded-lg border border-border/50 bg-[var(--bg-2)]/50 px-2.5 py-2">
                <div className="text-[11px] text-foreground-secondary/80">{t('context:approxTokens')}</div>
                <div className="text-[16px] font-semibold tabular-nums text-foreground">
                  {formatTokens(estTokens ?? 0)}
                </div>
                <div className="text-[10px] tabular-nums text-foreground-secondary/70">
                  {t('context:charsCount', { count: preview.estimatedChars })}
                </div>
              </div>
            </div>
            {ctxPct != null && contextWindow != null && (
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-foreground-secondary">
                  <span>{t('context:modelWindow')}</span>
                  <span className="tabular-nums">
                    {t('context:modelWindowFraction', {
                      used: formatTokens(estTokens!),
                      total: formatTokens(contextWindow),
                      pct: ctxPct.toFixed(1),
                    })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-3)]">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      ctxPct > 85 ? 'bg-amber-500' : 'bg-brand/90',
                    )}
                    style={{ width: `${ctxPct}%` }}
                  />
                </div>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-foreground-secondary/65">
              {t('context:messageOrderHint')}
            </p>
          </div>

          <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {segments.length === 0 ? (
              <p className="px-2 py-4 text-[12px] text-foreground-secondary/70">暂无消息片段</p>
            ) : (
              <div className="space-y-1">
                {segments.map((seg) => {
                  const meta = roleMeta(seg.role)
                  const open = expanded.has(seg.index)
                  const widthPct = Math.max(8, (seg.chars / maxChars) * 100)
                  return (
                    <div
                      key={seg.index}
                      className="overflow-hidden rounded-lg border border-border/40 bg-[var(--bg-base)]/80"
                    >
                      <button
                        type="button"
                        onClick={() => toggle(seg.index)}
                        className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"
                      >
                        {open ? (
                          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                        ) : (
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', meta.badge)}>
                              {meta.labelKey ? t(meta.labelKey) : seg.role}
                              {seg.label ? ` · ${seg.label}` : ''}
                            </span>
                            <span className="text-[10px] tabular-nums text-foreground-secondary/70">
                              #{seg.index + 1} · {seg.chars.toLocaleString()} 字 · ~{formatTokens(estTokensFromChars(seg.chars))} tok
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-3)]">
                            <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${widthPct}%` }} />
                          </div>
                          {!open && seg.preview && (
                            <p className="mt-1.5 line-clamp-2 font-mono text-[11px] leading-relaxed text-foreground-secondary/85">
                              {seg.preview}
                            </p>
                          )}
                        </div>
                      </button>
                      {open && (
                        <pre className="max-h-40 overflow-auto border-t border-border/30 bg-[var(--bg-2)]/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
                          {seg.preview || '(空)'}
                          {seg.chars > 280 && (
                            <span className="text-foreground-secondary/50"> … 共 {seg.chars} 字符</span>
                          )}
                        </pre>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}