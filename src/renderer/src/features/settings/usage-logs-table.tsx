import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  UsageLogPage,
  UsageLogRow,
  UsageLogSortField,
  UsageStopStatus,
} from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
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
import { UsageRequestDrawer } from './usage-request-drawer'

const PAGE_SIZES = [25, 50, 100] as const
const projectLabel = (p: string) => (p === '(unknown)' ? p : p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p)

function buildPageButtons(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | 'ellipsis')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) out.push('ellipsis')
  for (let p = start; p <= end; p++) out.push(p)
  if (end < total - 1) out.push('ellipsis')
  out.push(total)
  return out
}

function formatShortTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function shortApi(api: string): string {
  return api.replace(/^openai-/, '').replace(/^anthropic-/, '').replace(/^google-/, '')
}

function SortHeader({
  label,
  field,
  activeField,
  dir,
  align = 'right',
  onSort,
}: {
  label: string
  field: UsageLogSortField
  activeField: UsageLogSortField
  dir: 'asc' | 'desc'
  align?: 'left' | 'right'
  onSort: (f: UsageLogSortField) => void
}) {
  const active = activeField === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-muted-foreground hover:text-foreground',
        align === 'right' && 'ml-auto justify-end',
        active && 'text-foreground',
      )}
    >
      <span>{label}</span>
      {active ? (
        dir === 'desc' ? (
          <ArrowDown className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowUp className="h-3 w-3 shrink-0" />
        )
      ) : null}
    </button>
  )
}

export function UsageLogsTable({
  days,
  initialModel = '',
  initialProject = '',
  onOpenSession,
}: {
  days: number
  initialModel?: string
  initialProject?: string
  onOpenSession: (sessionFile: string, project: string, entryId?: string) => void
}) {
  const { t } = useTranslation()
  const [model, setModel] = useState(initialModel)
  const [project, setProject] = useState(initialProject)
  const [api, setApi] = useState('')
  const [status, setStatus] = useState<'all' | UsageStopStatus>('all')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState<UsageLogSortField>('ts')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [pageSize, setPageSize] = useState<number>(50)
  const [offset, setOffset] = useState(0)
  const [jumpInput, setJumpInput] = useState('1')
  const [reloadNonce, setReloadNonce] = useState(0)

  const [page, setPage] = useState<UsageLogPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  useEffect(() => {
    setModel(initialModel)
    setOffset(0)
  }, [initialModel])

  useEffect(() => {
    setProject(initialProject)
    setOffset(0)
  }, [initialProject])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput)
      setOffset(0)
    }, 180)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    setOffset(0)
  }, [days])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(false)
    ipcClient
      .invoke('usage.logs', {
        days,
        model: model || undefined,
        project: project || undefined,
        api: api || undefined,
        status,
        search: debouncedSearch || undefined,
        sortBy,
        sortDir,
        offset,
        limit: pageSize,
      })
      .then((res) => {
        if (!live) return
        setPage(res)
        setSelectedIdx(null)
      })
      .catch(() => {
        if (live) setError(true)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [days, model, project, api, status, debouncedSearch, sortBy, sortDir, offset, pageSize, reloadNonce])

  const totalPages = page ? Math.max(1, Math.ceil(page.totalCount / pageSize)) : 1
  const currentPage = Math.min(totalPages, Math.floor(offset / pageSize) + 1)

  useEffect(() => {
    setJumpInput(String(currentPage))
  }, [currentPage])

  const goToPage = (targetPage: number) => {
    const clamped = Math.max(1, Math.min(totalPages, Math.floor(targetPage)))
    setOffset((clamped - 1) * pageSize)
    setJumpInput(String(clamped))
  }

  const commitJumpInput = () => {
    const parsed = Number.parseInt(jumpInput.trim(), 10)
    if (!Number.isFinite(parsed)) {
      setJumpInput(String(currentPage))
      return
    }
    goToPage(parsed)
  }

  const handleSort = (field: UsageLogSortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
    setOffset(0)
  }

  const hasActiveFilter = !!(model || project || api || status !== 'all' || searchInput.trim())
  const resetFilters = () => {
    setModel('')
    setProject('')
    setApi('')
    setStatus('all')
    setSearchInput('')
    setDebouncedSearch('')
    setOffset(0)
  }

  const rows = page?.rows ?? []
  const selectedRow = selectedIdx != null && rows[selectedIdx] ? rows[selectedIdx] : null

  const statusBadge = (r: UsageLogRow) => {
    if (r.status === 'error') {
      return (
        <span
          title={r.errorMessage}
          className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300"
        >
          {t('settings:usage.statusError')}
        </span>
      )
    }
    if (r.status === 'aborted') {
      return (
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
          {t('settings:usage.statusAborted')}
        </span>
      )
    }
    if (r.status === 'length') {
      return (
        <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t('settings:usage.statusLength')}
        </span>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('settings:usage.filterSearchPlaceholder')}
            className="h-8 w-full rounded-md border border-border bg-[var(--bg-elevated)]/40 pl-8 pr-7 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <select
          aria-label={t('settings:usage.colModel')}
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            setOffset(0)
          }}
          className="h-8 max-w-[210px] truncate rounded-md border border-border bg-[var(--bg-elevated)]/40 px-2.5 text-[12px] text-foreground focus:outline-none"
        >
          <option value="">{t('settings:usage.filterAllModels')}</option>
          {(page?.facets.models ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          aria-label={t('settings:usage.byProject')}
          value={project}
          onChange={(e) => {
            setProject(e.target.value)
            setOffset(0)
          }}
          className="h-8 max-w-[170px] truncate rounded-md border border-border bg-[var(--bg-elevated)]/40 px-2.5 text-[12px] text-foreground focus:outline-none"
        >
          <option value="">{t('settings:usage.filterAllProjects')}</option>
          {(page?.facets.projects ?? []).map((p) => (
            <option key={p} value={p}>
              {projectLabel(p)}
            </option>
          ))}
        </select>

        <select
          aria-label={t('settings:usage.filterAllStatus')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'all' | UsageStopStatus)
            setOffset(0)
          }}
          className="h-8 rounded-md border border-border bg-[var(--bg-elevated)]/40 px-2.5 text-[12px] text-foreground focus:outline-none"
        >
          <option value="all">{t('settings:usage.filterAllStatus')}</option>
          <option value="ok">{t('settings:usage.statusOk')}</option>
          <option value="error">{t('settings:usage.statusError')}</option>
          <option value="aborted">{t('settings:usage.statusAborted')}</option>
          <option value="length">{t('settings:usage.statusLength')}</option>
        </select>

        {hasActiveFilter ? (
          <button
            type="button"
            onClick={resetFilters}
            className="h-8 rounded-md border border-border px-2.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t('settings:usage.clearFilters')}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setReloadNonce((n) => n + 1)}
          title={t('settings:usage.refresh')}
          aria-label={t('settings:usage.refresh')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Logs table */}
      <div className="settings-card overflow-hidden">
        {error ? (
          <div className="p-5 text-[12.5px] text-destructive">{t('settings:usage.failed')}</div>
        ) : !page && loading ? (
          <div className="flex items-center gap-2 p-5 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('settings:usage.loading')}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-[12.5px] text-muted-foreground">{t('settings:usage.empty')}</div>
        ) : (
          <div className="settings-flush overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-border/70 bg-[var(--bg-elevated)]/40">
                  <th className="px-4 py-2.5 font-semibold">
                    <SortHeader
                      label={t('settings:usage.colTimeSession')}
                      field="ts"
                      activeField={sortBy}
                      dir={sortDir}
                      align="left"
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    {t('settings:usage.colModel')}
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <SortHeader
                      label={t('settings:usage.colTokens')}
                      field="tokens"
                      activeField={sortBy}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <SortHeader
                      label={t('settings:usage.colCache')}
                      field="cacheRead"
                      activeField={sortBy}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <SortHeader
                      label={t('settings:usage.colLatency')}
                      field="duration"
                      activeField={sortBy}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <SortHeader
                      label={t('settings:usage.colTps')}
                      field="tps"
                      activeField={sortBy}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-right">
                    <SortHeader
                      label={t('settings:usage.colCost')}
                      field="cost"
                      activeField={sortBy}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r, idx) => {
                  const isSelected = selectedIdx === idx
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedIdx(idx)}
                      className={cn(
                        'group cursor-pointer transition-colors hover:bg-accent/40',
                        isSelected && 'bg-accent/60',
                      )}
                    >
                      {/* 1. Time & Session */}
                      <td className="max-w-[220px] px-4 py-2.5 align-top">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11.5px] font-medium tabular-nums text-foreground">
                            {formatShortTime(r.ts)}
                          </span>
                          <button
                            type="button"
                            title={t('settings:usage.openInChat')}
                            aria-label={t('settings:usage.openInChat')}
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenSession(r.sessionFile, r.project, r.entryId)
                            }}
                            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={r.sessionTitle}>
                          <span className="font-medium text-foreground-secondary">{projectLabel(r.project)}</span>
                          {' · '}
                          {r.sessionTitle || t('settings:usage.untitled')}
                        </div>
                      </td>

                      {/* 2. Model & Status */}
                      <td className="max-w-[230px] px-3 py-2.5 align-top">
                        <div className="truncate font-mono text-[11.5px] font-medium text-foreground" title={r.model}>
                          {r.model}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {statusBadge(r)}
                          {r.responseModel ? (
                            <span
                              title={t('settings:usage.routedTo', { model: r.responseModel })}
                              className="max-w-[130px] truncate rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0 text-[10px] font-mono text-amber-700 dark:text-amber-300"
                            >
                              → {r.responseModel}
                            </span>
                          ) : null}
                          {r.thinkingLevel ? (
                            <span className="rounded bg-muted/60 px-1.5 py-0 font-mono text-[10px] text-foreground-secondary">
                              {r.thinkingLevel}
                            </span>
                          ) : null}
                          {r.api ? (
                            <span className="font-mono text-[10px] text-muted-foreground">{shortApi(r.api)}</span>
                          ) : null}
                        </div>
                      </td>

                      {/* 3. Tokens (Total + In/Out/Reasoning) */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums">
                        <div className="font-mono text-[12px] font-semibold text-foreground">
                          {r.totalTokens.toLocaleString()}
                        </div>
                        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {t('settings:usage.input')} {formatTokens(r.input)} · {t('settings:usage.output')} {formatTokens(r.output)}
                          {r.reasoning > 0 ? ` (${t('settings:usage.reasoning')} ${formatTokens(r.reasoning)})` : ''}
                        </div>
                      </td>

                      {/* 4. Cache Read / Write */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums">
                        {r.cacheRead > 0 ? (
                          <div className="font-mono text-[11.5px] font-medium text-foreground">
                            {formatTokens(r.cacheRead)}{' '}
                            <span className={cn('text-[10.5px]', cacheHitTone(r.cacheHitRate))}>
                              ({formatPct(r.cacheHitRate)})
                            </span>
                          </div>
                        ) : (
                          <div className="font-mono text-[11.5px] text-muted-foreground">—</div>
                        )}
                        {r.cacheWrite > 0 ? (
                          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                            +{formatTokens(r.cacheWrite)}
                            {r.cacheWrite1h > 0 ? ` (${t('settings:usage.cache1h', { value: formatTokens(r.cacheWrite1h) })})` : ''}
                          </div>
                        ) : null}
                      </td>

                      {/* 5. Latency (TTFT + Total) */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-mono tabular-nums">
                        <div className={cn('text-[11.5px]', ttftTone(r.ttftMs))}>
                          {r.ttftMs != null ? `${t('settings:usage.ttftShort')} ${formatDurationMs(r.ttftMs)}` : `${t('settings:usage.ttftShort')} —`}
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                          {formatDurationMs(r.durationMs)}
                        </div>
                      </td>

                      {/* 6. Throughput (TPS) */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-mono tabular-nums">
                        {r.genTps != null ? (
                          <>
                            <div className={cn('text-[11.5px] font-medium', tpsTone(r.genTps, true))}>
                              {formatTps(r.genTps)} tok/s
                            </div>
                            <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                              {t('settings:usage.tpsTotal', { value: formatTps(r.totalTps) })}
                            </div>
                          </>
                        ) : r.totalTps != null ? (
                          <>
                            <div className={cn('text-[11.5px] font-medium', tpsTone(r.totalTps, false))}>
                              {formatTps(r.totalTps)} tok/s
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">E2E</div>
                          </>
                        ) : (
                          <span className="text-[11.5px] text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* 7. Cost */}
                      <td
                        className="whitespace-nowrap px-4 py-2.5 text-right align-top font-mono text-[12px] font-medium tabular-nums text-foreground"
                        title={`${t('settings:usage.input')}: ${formatExactCost(r.costBreakdown.input)} | ${t('settings:usage.output')}: ${formatExactCost(r.costBreakdown.output)} | ${t('settings:usage.cacheRead')}: ${formatExactCost(r.costBreakdown.cacheRead)} | ${t('settings:usage.cacheWrite')}: ${formatExactCost(r.costBreakdown.cacheWrite)}`}
                      >
                        {formatExactCost(r.cost)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer with page numbers, per-page selector & direct page jump */}
        {page && page.totalCount > 0 ? (
          <div className="settings-flush border-t border-border/60 bg-[var(--bg-elevated)]/20">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[11.5px] text-muted-foreground">
            <div className="flex items-center gap-2.5">
              <span className="tabular-nums">
                {t('settings:usage.pageInfo', {
                  from: page.offset + 1,
                  to: Math.min(page.offset + rows.length, page.totalCount),
                  total: page.totalCount,
                })}
              </span>
              <select
                value={pageSize}
                aria-label="Page size"
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setOffset(0)
                }}
                className="h-7 rounded border border-border bg-background px-2 text-[11.5px] text-foreground focus:outline-none"
              >
                {PAGE_SIZES.map((sz) => (
                  <option key={sz} value={sz}>
                    {t('settings:usage.perPage', { count: sz })}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1 || loading}
                onClick={() => goToPage(currentPage - 1)}
                className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-foreground-secondary hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t('settings:usage.prevPage')}
              </button>

              {totalPages > 1 ? (
                <div className="flex items-center gap-1">
                  {buildPageButtons(currentPage, totalPages).map((item, i) =>
                    item === 'ellipsis' ? (
                      <span key={`el-${i}`} className="px-1 font-mono text-[11px] text-muted-foreground">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        disabled={loading}
                        onClick={() => goToPage(item)}
                        aria-current={item === currentPage ? 'page' : undefined}
                        className={cn(
                          'inline-flex h-7 min-w-7 items-center justify-center rounded border px-1.5 font-mono text-[11.5px] tabular-nums transition-colors',
                          item === currentPage
                            ? 'border-primary/45 bg-primary/10 font-semibold text-primary'
                            : 'border-border bg-background text-foreground-secondary hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {item}
                      </button>
                    ),
                  )}
                </div>
              ) : null}

              <button
                type="button"
                disabled={currentPage >= totalPages || loading}
                onClick={() => goToPage(currentPage + 1)}
                className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-foreground-secondary hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {t('settings:usage.nextPage')}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>

              {totalPages > 1 ? (
                <div className="ml-1.5 flex items-center gap-1.5 border-l border-border/70 pl-2.5">
                  <span>{t('settings:usage.jumpToPage')}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={t('settings:usage.jumpToPage')}
                    value={jumpInput}
                    onChange={(e) => setJumpInput(e.target.value.replace(/[^\d]/g, ''))}
                    onBlur={commitJumpInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitJumpInput()
                      }
                    }}
                    className="h-7 w-11 rounded border border-border bg-background px-1.5 text-center font-mono text-[11.5px] tabular-nums text-foreground focus:border-primary/60 focus:outline-none"
                  />
                  <span className="font-mono tabular-nums">
                    {t('settings:usage.pageTotal', { total: totalPages })}
                  </span>
                </div>
              ) : null}
            </div>
            </div>
          </div>
        ) : null}
      </div>

      <UsageRequestDrawer
        row={selectedRow}
        onClose={() => setSelectedIdx(null)}
        onPrev={selectedIdx != null && selectedIdx > 0 ? () => setSelectedIdx(selectedIdx - 1) : undefined}
        onNext={selectedIdx != null && selectedIdx < rows.length - 1 ? () => setSelectedIdx(selectedIdx + 1) : undefined}
        onOpenSession={(sf, proj, eid) => {
          setSelectedIdx(null)
          onOpenSession(sf, proj, eid)
        }}
      />
    </div>
  )
}
