import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type {
  UsageContextMessageItem,
  UsageLogRow,
  UsageMessageBlock,
  UsageRequestDetail,
} from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  X,
} from '@renderer/components/icons'
import {
  cacheHitTone,
  formatDurationMs,
  formatExactCost,
  formatPct,
  formatTokens,
  formatTps,
  tpsTone,
  ttftTone,
} from './usage-charts'

function formatTimestampFull(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** Lazy tree viewer capped at depth 2 by default so multi-hundred-KB conversations never freeze DOM. */
function CompactJsonNode({
  name,
  value,
  depth,
  defaultExpandDepth = 2,
}: {
  name?: string
  value: unknown
  depth: number
  defaultExpandDepth?: number
}) {
  const isObj = value !== null && typeof value === 'object'
  const entries = useMemo(() => {
    if (!isObj) return []
    return Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>)
  }, [isObj, value])

  const [open, setOpen] = useState(depth < defaultExpandDepth && entries.length <= 50)

  if (!isObj) {
    const rendered =
      typeof value === 'string'
        ? JSON.stringify(value.length > 600 ? `${value.slice(0, 600)}…` : value)
        : String(value)
    const valTone =
      typeof value === 'string'
        ? 'text-emerald-700 dark:text-emerald-400'
        : typeof value === 'number' || typeof value === 'boolean'
          ? 'text-sky-700 dark:text-sky-400'
          : 'text-muted-foreground'
    return (
      <div className="py-0.5 font-mono text-[11.5px] leading-[1.5] break-all">
        {name !== undefined ? <span className="text-foreground-secondary">{name}: </span> : null}
        <span className={valTone}>{rendered}</span>
      </div>
    )
  }

  const bracketOpen = Array.isArray(value) ? '[' : '{'
  const bracketClose = Array.isArray(value) ? ']' : '}'

  if (entries.length === 0) {
    return (
      <div className="py-0.5 font-mono text-[11.5px] leading-[1.5] text-muted-foreground">
        {name !== undefined ? <span className="text-foreground-secondary">{name}: </span> : null}
        {bracketOpen}
        {bracketClose}
      </div>
    )
  }

  return (
    <div className="font-mono text-[11.5px] leading-[1.5]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-0.5 py-0.5 text-left hover:bg-accent/50"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        {name !== undefined ? <span className="text-foreground-secondary">{name}: </span> : null}
        <span className="text-muted-foreground">
          {bracketOpen}
          {!open ? ` ${entries.length} ${Array.isArray(value) ? 'items' : 'keys'} ${bracketClose}` : ''}
        </span>
      </button>
      {open ? (
        <div className="ml-3 border-l border-border/60 pl-2.5">
          {entries.map(([k, v]) => (
            <CompactJsonNode
              key={k}
              name={Array.isArray(value) ? undefined : k}
              value={v}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
            />
          ))}
          <div className="text-muted-foreground">{bracketClose}</div>
        </div>
      ) : null}
    </div>
  )
}

function MessageBlocksView({ blocks }: { blocks: readonly UsageMessageBlock[] }) {
  const { t } = useTranslation()
  if (blocks.length === 0) {
    return <div className="text-[12px] italic text-muted-foreground">{t('settings:usage.noContent')}</div>
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, idx) => {
        if (b.type === 'thinking') {
          return (
            <div key={idx} className="rounded-md border border-border/60 bg-[var(--bg-elevated)]/60 px-3 py-2">
              <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t('settings:usage.blockThinking')} · {b.thinking.length.toLocaleString()} chars
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-foreground-secondary">
                {b.thinking}
              </pre>
            </div>
          )
        }
        if (b.type === 'text') {
          return (
            <pre
              key={idx}
              className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-foreground"
            >
              {b.text}
            </pre>
          )
        }
        if (b.type === 'toolCall') {
          return (
            <div key={idx} className="rounded-md border border-border/70 bg-[var(--bg-elevated)]/50 px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[11.5px]">
                <span className="font-semibold text-foreground">
                  {t('settings:usage.blockToolCall')}: {b.name}
                </span>
                {b.id ? <span className="truncate text-[10.5px] text-muted-foreground">{b.id}</span> : null}
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-foreground-secondary">
                {JSON.stringify(b.arguments, null, 2)}
              </pre>
            </div>
          )
        }
        return (
          <div
            key={idx}
            className="inline-flex w-fit items-center gap-2 rounded border border-border/70 bg-muted/30 px-2.5 py-1 text-[11.5px] text-muted-foreground"
          >
            {t('settings:usage.imageOmitted', { mime: b.mimeType, size: formatByteSize(b.bytes) })}
          </div>
        )
      })}
    </div>
  )
}

function ContextMessageCard({ item, highlighted }: { item: UsageContextMessageItem; highlighted?: boolean }) {
  const [expanded, setExpanded] = useState(highlighted ?? false)
  const roleBadge =
    item.role === 'user'
      ? 'border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : item.role === 'assistant'
        ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : item.role === 'toolResult'
          ? 'border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted/40 text-muted-foreground'

  return (
    <div
      className={cn(
        'rounded-lg border transition-colors',
        highlighted ? 'border-border bg-[var(--bg-surface,var(--bg-base))]' : 'border-border/60 bg-[var(--bg-elevated)]/30',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-accent/30"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10.5px] font-medium', roleBadge)}>
          {item.role}
          {item.toolName ? ` · ${item.toolName}` : ''}
        </span>
        {item.isError ? (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">
            error
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground-secondary">
          {item.summary || '…'}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">#{item.index + 1}</span>
      </button>
      {expanded ? (
        <div className="border-t border-border/50 px-3 py-2.5">
          <MessageBlocksView blocks={item.blocks} />
        </div>
      ) : null}
    </div>
  )
}

export function UsageRequestDrawer({
  row,
  onClose,
  onPrev,
  onNext,
  onOpenSession,
}: {
  row: UsageLogRow | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onOpenSession: (sessionFile: string, project: string, entryId: string) => void
}) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<UsageRequestDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'request' | 'response'>('request')
  const [viewMode, setViewMode] = useState<'structured' | 'json'>('structured')
  const [showEarlier, setShowEarlier] = useState(false)
  const [showSys, setShowSys] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!row) {
      setDetail(null)
      setErr(null)
      return
    }
    let live = true
    setLoading(true)
    setErr(null)
    setShowEarlier(false)
    setShowSys(false)
    setShowTools(false)
    ipcClient
      .invoke('usage.requestDetail', { sessionFile: row.sessionFile, entryId: row.entryId })
      .then((res) => {
        if (live) setDetail(res)
      })
      .catch((e: unknown) => {
        if (live) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [row?.sessionFile, row?.entryId])

  useEffect(() => {
    if (!row) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowUp' && onPrev && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowDown' && onNext && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [row, onClose, onPrev, onNext])

  if (!row) return null

  const copyPayload = async () => {
    if (!detail) return
    let text = ''
    if (viewMode === 'json') {
      text = JSON.stringify(tab === 'request' ? detail.request.rawContextJson : detail.response.rawMessageJson, null, 2)
    } else if (tab === 'response') {
      text = detail.response.blocks
        .map((b) => {
          if (b.type === 'thinking') return `[Thinking]\n${b.thinking}`
          if (b.type === 'text') return b.text
          if (b.type === 'toolCall') return `[ToolCall: ${b.name}]\n${JSON.stringify(b.arguments, null, 2)}`
          return `[Image: ${b.mimeType}]`
        })
        .join('\n\n')
    } else {
      const slice = showEarlier
        ? detail.request.messages
        : detail.request.messages.slice(detail.request.focusStartIndex)
      text = slice
        .map((m) => {
          const body = m.blocks
            .map((b) => (b.type === 'text' ? b.text : b.type === 'thinking' ? b.thinking : JSON.stringify(b)))
            .join('\n')
          return `[${m.role}]\n${body}`
        })
        .join('\n\n')
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const earlierMessages = detail ? detail.request.messages.slice(0, detail.request.focusStartIndex) : []
  const focusedMessages = detail ? detail.request.messages.slice(detail.request.focusStartIndex) : []

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={row.model}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-[min(800px,94vw)] flex-col border-l border-border bg-[var(--bg-base)] text-foreground shadow-2xl"
      >
        {/* Top bar */}
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[14px] font-semibold text-foreground">{row.model}</span>
              {row.responseModel ? (
                <span className="rounded border border-amber-600/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-300">
                  {t('settings:usage.routedTo', { model: row.responseModel })}
                </span>
              ) : null}
              {row.thinkingLevel ? (
                <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground-secondary">
                  {row.thinkingLevel}
                </span>
              ) : null}
              {row.api ? (
                <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {row.api}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
              <span className="font-mono tabular-nums">{formatTimestampFull(row.ts)}</span>
              <span className="max-w-[260px] truncate">{row.sessionTitle || t('settings:usage.untitled')}</span>
              {row.responseId ? <span className="max-w-[200px] truncate font-mono">{row.responseId}</span> : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenSession(row.sessionFile, row.project, row.entryId)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11.5px] text-foreground-secondary hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('settings:usage.openInChat')}
            </button>
            <button
              type="button"
              disabled={!onPrev}
              onClick={onPrev}
              title={t('settings:usage.drawerPrev')}
              aria-label={t('settings:usage.drawerPrev')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground-secondary hover:bg-accent disabled:opacity-35"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!onNext}
              onClick={onNext}
              title={t('settings:usage.drawerNext')}
              aria-label={t('settings:usage.drawerNext')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground-secondary hover:bg-accent disabled:opacity-35"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('settings:usage.drawerClose')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 6-cell telemetry strip */}
        <div className="grid grid-cols-3 gap-2 border-b border-border/60 bg-[var(--bg-elevated)]/35 px-5 py-3 sm:grid-cols-6">
          <div>
            <div className="text-[10.5px] text-muted-foreground">{t('settings:usage.input')}</div>
            <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">{row.input.toLocaleString()}</div>
            <div className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {formatExactCost(row.costBreakdown.input)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-muted-foreground">{t('settings:usage.output')}</div>
            <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">{row.output.toLocaleString()}</div>
            <div className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {row.reasoning > 0 ? `${t('settings:usage.reasoning')} ${formatTokens(row.reasoning)} · ` : ''}
              {formatExactCost(row.costBreakdown.output)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-muted-foreground">{t('settings:usage.cacheRead')}</div>
            <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">
              {row.cacheRead.toLocaleString()}
            </div>
            <div className={cn('font-mono text-[10.5px] tabular-nums', cacheHitTone(row.cacheHitRate))}>
              {formatPct(row.cacheHitRate)} · {formatExactCost(row.costBreakdown.cacheRead)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-muted-foreground">{t('settings:usage.cacheWrite')}</div>
            <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">
              {row.cacheWrite.toLocaleString()}
            </div>
            <div className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {row.cacheWrite1h > 0 ? `1h ${formatTokens(row.cacheWrite1h)} · ` : ''}
              {formatExactCost(row.costBreakdown.cacheWrite)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-muted-foreground">{t('settings:usage.colLatency')}</div>
            <div className={cn('mt-0.5 font-mono text-[13px] font-semibold tabular-nums', ttftTone(row.ttftMs))}>
              {row.ttftMs != null ? formatDurationMs(row.ttftMs) : '—'}
            </div>
            <div className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {t('settings:usage.totalDuration')} {formatDurationMs(row.durationMs)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-muted-foreground">{t('settings:usage.colTps')} / {t('settings:usage.cost')}</div>
            <div className={cn('mt-0.5 font-mono text-[13px] font-semibold tabular-nums', tpsTone(row.genTps ?? row.totalTps, row.genTps != null))}>
              {formatTps(row.genTps ?? row.totalTps)} tok/s
            </div>
            <div className="font-mono text-[10.5px] font-medium tabular-nums text-foreground">
              {formatExactCost(row.cost)}
            </div>
          </div>
        </div>

        {/* Error banner if failed/aborted */}
        {(detail?.response.errorMessage || row.errorMessage) ? (
          <div className="flex items-start gap-2 border-b border-rose-500/30 bg-rose-500/10 px-5 py-2.5 text-[12px] text-rose-800 dark:text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1 break-words font-mono text-[11.5px]">
              {detail?.response.errorMessage || row.errorMessage}
            </div>
          </div>
        ) : null}

        {/* Sub-toolbar: Request / Response tabs + Structured / Raw JSON + Copy */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-2.5">
          <div role="tablist" className="settings-segmented flex h-[28px] gap-0.5 rounded-md p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'request'}
              onClick={() => setTab('request')}
              className="settings-segmented-item rounded-[4px] px-3 text-[12px]"
            >
              {t('settings:usage.tabRequest')}
              {detail ? ` (${detail.request.totalMessages})` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'response'}
              onClick={() => setTab('response')}
              className="settings-segmented-item rounded-[4px] px-3 text-[12px]"
            >
              {t('settings:usage.tabResponse')}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div role="radiogroup" className="settings-segmented flex h-[26px] gap-0.5 rounded-md p-0.5">
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'structured'}
                onClick={() => setViewMode('structured')}
                className="settings-segmented-item rounded-[4px] px-2.5 text-[11.5px]"
              >
                {t('settings:usage.modeStructured')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'json'}
                onClick={() => setViewMode('json')}
                className="settings-segmented-item rounded-[4px] px-2.5 text-[11.5px]"
              >
                {t('settings:usage.modeJson')}
              </button>
            </div>
            <button
              type="button"
              disabled={!detail}
              onClick={() => void copyPayload()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11.5px] text-foreground-secondary hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('settings:copied') : viewMode === 'json' ? t('settings:usage.copyJson') : t('settings:usage.copyText')}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('settings:usage.detailLoading')}
            </div>
          ) : err ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12.5px] text-destructive">
              {t('settings:usage.detailFailed', { error: err })}
            </div>
          ) : !detail ? null : viewMode === 'json' ? (
            <div className="rounded-lg border border-border/70 bg-[var(--bg-elevated)]/35 p-3.5">
              <CompactJsonNode
                value={tab === 'request' ? detail.request.rawContextJson : detail.response.rawMessageJson}
                depth={0}
                defaultExpandDepth={2}
              />
            </div>
          ) : tab === 'request' ? (
            <div className="flex flex-col gap-3">
              {/* Collapsible System Prompt & Declared Tools pills */}
              {(detail.request.systemSections.length > 0 || detail.request.toolsDeclared.added.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {detail.request.systemSections.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowSys((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-[var(--bg-elevated)]/50 px-2.5 py-1 text-[11.5px] text-foreground-secondary hover:bg-accent/50 hover:text-foreground"
                    >
                      {showSys ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {t('settings:usage.systemPromptCount', { count: detail.request.systemSections.length })}
                    </button>
                  ) : null}
                  {detail.request.toolsDeclared.added.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowTools((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-[var(--bg-elevated)]/50 px-2.5 py-1 text-[11.5px] text-foreground-secondary hover:bg-accent/50 hover:text-foreground"
                    >
                      {showTools ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {t('settings:usage.declaredToolsCount', { count: detail.request.toolsDeclared.added.length })}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {showSys ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-[var(--bg-elevated)]/40 p-3">
                  {detail.request.systemSections.map((sec) => (
                    <div key={sec.name}>
                      <div className="mb-1 font-mono text-[11px] font-semibold text-foreground-secondary">
                        [{sec.name}]
                      </div>
                      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-muted-foreground">
                        {sec.content ?? '—'}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : null}

              {showTools ? (
                <div className="rounded-lg border border-border/70 bg-[var(--bg-elevated)]/40 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {detail.request.toolsDeclared.added.map((tool) => (
                      <span
                        key={tool.name}
                        title={tool.description}
                        className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground"
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                  {detail.request.toolsDeclared.removed.length > 0 ? (
                    <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {t('settings:usage.removedTools', { names: detail.request.toolsDeclared.removed.join(', ') })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Earlier conversation context folded by default */}
              {earlierMessages.length > 0 ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowEarlier((v) => !v)}
                    className="flex w-full items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {showEarlier ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {showEarlier
                        ? t('settings:usage.earlierMessagesCollapse', { count: earlierMessages.length })
                        : t('settings:usage.earlierMessagesToggle', { count: earlierMessages.length })}
                    </span>
                  </button>
                  {showEarlier ? (
                    <div className="mt-2 flex flex-col gap-2">
                      {earlierMessages.map((m) => (
                        <ContextMessageCard key={m.index} item={m} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Focused current-turn trigger input */}
              <div className="mt-1">
                <div className="mb-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-foreground-secondary uppercase">
                  {t('settings:usage.currentTurnTrigger', { count: focusedMessages.length })}
                </div>
                {focusedMessages.length === 0 ? (
                  <div className="text-[12px] italic text-muted-foreground">{t('settings:usage.noContent')}</div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {focusedMessages.map((m) => (
                      <ContextMessageCard key={m.index} item={m} highlighted />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <MessageBlocksView blocks={detail.response.blocks} />

              {detail.response.toolResults.length > 0 ? (
                <div className="border-t border-border/60 pt-3">
                  <div className="mb-2 text-[11px] font-semibold tracking-wide text-foreground-secondary uppercase">
                    {t('settings:usage.blockToolResults', { count: detail.response.toolResults.length })}
                  </div>
                  <div className="flex flex-col gap-2">
                    {detail.response.toolResults.map((tr) => (
                      <div key={tr.toolCallId} className="rounded-lg border border-border/70 bg-[var(--bg-elevated)]/35 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                          <span className={cn('font-semibold', tr.isError ? 'text-rose-700 dark:text-rose-400' : 'text-foreground')}>
                            {tr.toolName} {tr.isError ? '(error)' : ''}
                          </span>
                          <span className="text-muted-foreground">
                            {tr.durationMs != null ? formatDurationMs(tr.durationMs) : ''}
                          </span>
                        </div>
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-foreground-secondary">
                          {tr.text || t('settings:usage.noContent')}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
