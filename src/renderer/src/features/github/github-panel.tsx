import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  ExternalLink,
  FolderGit2,
  GitFork,
  MessageSquare,
  RefreshCw,
  Search,
  XCircle,
} from '@renderer/components/icons'
import {
  groupGitHubChecks,
  type GitHubChecksState,
  type GitHubIssueSummary,
  type GitHubListIssuesResult,
  type GitHubListPrsResult,
  type GitHubPrDetailResult,
  type GitHubPullRequestSummary,
  type GitHubRepoRef,
  type GitHubStatusErrorCode,
} from '@shared/github-status'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { usePanelIntentStore } from '@renderer/stores/panel-intent-store'
import { cn } from '@renderer/lib/utils'
import { QuestionnaireMarkdown } from '@renderer/features/extension-ui/questionnaire-markdown'
import {
  buildIssueWorkPrompt,
  buildPrFixChecksPrompt,
  buildPrResolveConflictsPrompt,
  buildPrWorkPrompt,
  handoffGitHubItemToPi,
  openGitHubExternal,
} from './github-actions'

type Mode = 'prs' | 'issues'
type StateFilter = 'open' | 'closed' | 'all'
type InvolvementFilter = 'all' | 'involved' | 'authored' | 'assigned'

// In-memory SWR cache across tab switches so reopening GitHubPanel is instant with zero white-flash
const listCache = new Map<
  string,
  { repo: GitHubRepoRef | null; prs?: GitHubPullRequestSummary[]; issues?: GitHubIssueSummary[] }
>()

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

function labelBadgeStyle(hex?: string | null): React.CSSProperties | undefined {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return {
    backgroundColor: `color-mix(in srgb, #${hex} 14%, transparent)`,
    borderColor: `color-mix(in srgb, #${hex} 34%, transparent)`,
  }
}

function ChecksGlyph({ state }: { state: GitHubChecksState }) {
  if (state === 'failing') return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
  if (state === 'passing') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
  if (state === 'pending') return <Clock className="h-3.5 w-3.5 shrink-0 text-sky-500" />
  return null
}

function PrStateBadge({ pr, t }: { pr: GitHubPullRequestSummary; t: (k: string) => string }) {
  if (pr.state === 'merged') {
    return (
      <span className="inline-flex items-center rounded-full bg-violet-500/12 px-2 py-0.5 text-[10.5px] font-medium text-violet-600 dark:text-violet-400">
        {t('common:github.merged')}
      </span>
    )
  }
  if (pr.state === 'closed') {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--bg-2)] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
        {t('common:github.closed')}
      </span>
    )
  }
  if (pr.isDraft) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--bg-2)] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
        {t('common:github.draft')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
      {t('common:github.open')}
    </span>
  )
}

export function GitHubPanel() {
  const { t } = useTranslation()
  const cwd = useUIStore((s) => s.currentWorkspace)
  const focusedPrNumber = usePanelIntentStore((s) => s.focusedPrNumber)
  const consumeFocusedPr = usePanelIntentStore((s) => s.consumeFocusedPr)

  const [mode, setMode] = useState<Mode>('prs')
  const [stateFilter, setStateFilter] = useState<StateFilter>('open')
  const [involvement, setInvolvement] = useState<InvolvementFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [repo, setRepo] = useState<GitHubRepoRef | null>(null)
  const [prs, setPrs] = useState<GitHubPullRequestSummary[]>([])
  const [issues, setIssues] = useState<GitHubIssueSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [errorCode, setErrorCode] = useState<GitHubStatusErrorCode | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [selectedPr, setSelectedPr] = useState<GitHubPullRequestSummary | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssueSummary | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showPassedChecks, setShowPassedChecks] = useState(false)
  const [showDiscussions, setShowDiscussions] = useState(true)
  const [busyAction, setBusyAction] = useState(false)

  const listScrollRef = useRef<HTMLDivElement>(null)
  const savedScrollTopRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 240)
    return () => window.clearTimeout(timer)
  }, [searchText])

  // Escape inside PR or Issue detail smoothly returns to the list while restoring scroll position!
  useEffect(() => {
    if (!selectedPr && !selectedIssue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setSelectedPr(null)
      setSelectedIssue(null)
      requestAnimationFrame(() => {
        if (listScrollRef.current) listScrollRef.current.scrollTop = savedScrollTopRef.current
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedPr, selectedIssue])

  const loadList = useCallback(
    async (force = false) => {
      if (!cwd) {
        setPrs([])
        setIssues([])
        setRepo(null)
        setErrorCode('not-git')
        return
      }
      const cacheKey = `${cwd}|${mode}|${stateFilter}|${involvement}|${debouncedSearch}`
      const cached = !force ? listCache.get(cacheKey) : undefined
      if (cached) {
        setRepo(cached.repo)
        if (mode === 'prs' && cached.prs) setPrs(cached.prs)
        if (mode === 'issues' && cached.issues) setIssues(cached.issues)
      }
      setLoading(true)
      setErrorCode(null)
      setErrorMsg(null)
      try {
        if (mode === 'prs') {
          const res = (await ipcClient.invoke('github.listPrs', {
            cwd,
            state: stateFilter,
            involvement,
            search: debouncedSearch || undefined,
            force,
          })) as GitHubListPrsResult
          setRepo(res.repo ?? null)
          if (!res.ok) {
            if (!cached) setPrs([])
            setErrorCode(res.errorCode ?? 'api-error')
            setErrorMsg(res.error ?? null)
          } else {
            setPrs(res.items)
            listCache.set(cacheKey, { repo: res.repo ?? null, prs: res.items })
          }
        } else {
          const res = (await ipcClient.invoke('github.listIssues', {
            cwd,
            state: stateFilter,
            involvement,
            search: debouncedSearch || undefined,
            force,
          })) as GitHubListIssuesResult
          setRepo(res.repo ?? null)
          if (!res.ok) {
            if (!cached) setIssues([])
            setErrorCode(res.errorCode ?? 'api-error')
            setErrorMsg(res.error ?? null)
          } else {
            setIssues(res.items)
            listCache.set(cacheKey, { repo: res.repo ?? null, issues: res.items })
          }
        }
      } catch (e) {
        setErrorCode('api-error')
        setErrorMsg(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [cwd, mode, stateFilter, involvement, debouncedSearch],
  )

  useEffect(() => {
    setSelectedPr(null)
    setSelectedIssue(null)
    void loadList(false)
  }, [loadList])

  const openPrDetailByNumber = useCallback(
    async (prNum: number, seed?: GitHubPullRequestSummary) => {
      if (!cwd) return
      savedScrollTopRef.current = listScrollRef.current?.scrollTop ?? 0
      setMode('prs')
      setSelectedIssue(null)
      if (seed) setSelectedPr(seed)
      setShowPassedChecks(false)
      setDetailLoading(true)
      try {
        const res = (await ipcClient.invoke('github.prDetail', {
          cwd,
          number: prNum,
        })) as GitHubPrDetailResult
        if (res?.ok && res.pr) setSelectedPr(res.pr)
      } finally {
        setDetailLoading(false)
      }
    },
    [cwd],
  )

  useEffect(() => {
    if (focusedPrNumber != null && cwd) {
      const target = focusedPrNumber
      consumeFocusedPr()
      void openPrDetailByNumber(target)
    }
  }, [focusedPrNumber, cwd, consumeFocusedPr, openPrDetailByNumber])

  const backToList = () => {
    setSelectedPr(null)
    setSelectedIssue(null)
    requestAnimationFrame(() => {
      if (listScrollRef.current) listScrollRef.current.scrollTop = savedScrollTopRef.current
    })
  }

  const runHandoff = async (
    workspaceMode: 'local' | 'worktree',
    kind: 'pr' | 'issue',
    title: string,
    prompt: string,
    branchHint: string,
    labelNumber: number,
    baseBranch?: string,
  ) => {
    if (!cwd || busyAction) return
    setBusyAction(true)
    try {
      await handoffGitHubItemToPi({
        mode: workspaceMode,
        kind,
        title,
        cwd,
        prompt,
        branchHint,
        baseBranch,
        fromOrigin: workspaceMode === 'worktree',
        number: labelNumber,
      })
    } finally {
      setBusyAction(false)
    }
  }

  /* ── PR Detail View ── */
  if (selectedPr) {
    const pr = selectedPr
    const grouped = groupGitHubChecks(pr.checks)
    const hasFailing = grouped.attention.length > 0
    const hasConflict = pr.mergeable === 'CONFLICTING'
    const discussions = pr.discussions ?? []

    return (
      <div data-pi-slot="github-panel" className="flex h-full min-h-0 flex-col text-[12.5px]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/55 px-3 py-2">
          <button
            type="button"
            onClick={backToList}
            title="Esc"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('common:github.backToList')}</span>
          </button>
          <div className="flex items-center gap-1.5">
            <PrStateBadge pr={pr} t={t} />
            <button
              type="button"
              onClick={() => openGitHubExternal(pr.url)}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              <span>{t('common:github.openOnGithub')}</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="studio-thin-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          <div className="text-[14px] font-semibold leading-snug text-foreground">
            <span className="mr-1.5 font-mono text-muted-foreground">#{pr.number}</span>
            {pr.title}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              {pr.headRefName} → {pr.baseRefName}
            </span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400">+{pr.additions}</span>
            <span className="font-mono text-rose-500">-{pr.deletions}</span>
            {pr.author && <span>@{pr.author.login}</span>}
            {hasConflict && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {t('common:github.conflicting')}
              </span>
            )}
          </div>

          {pr.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {pr.labels.map((l) => (
                <span
                  key={l.name}
                  style={labelBadgeStyle(l.color)}
                  className="rounded-full border border-border/50 bg-[var(--bg-2)] px-2 py-0.5 text-[10.5px] text-foreground-secondary"
                >
                  {l.name}
                </span>
              ))}
            </div>
          )}

          {/* CI Checks */}
          <div className="mt-3.5 rounded-lg border border-border/65 bg-[var(--bg-1)]/45 p-2.5">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <ChecksGlyph state={pr.checksState} />
                <span>{t('common:github.checksTitle')}</span>
              </span>
              {detailLoading ? (
                <span className="text-[11px] text-muted-foreground">{t('common:loading')}</span>
              ) : pr.checks.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">{t('common:github.checksNone')}</span>
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {grouped.passed.length}/{pr.checks.length}
                </span>
              )}
            </div>

            {(grouped.attention.length > 0 || grouped.running.length > 0) && (
              <div className="mt-2 flex flex-col gap-0.5">
                {[...grouped.attention, ...grouped.running].map((c, idx) => (
                  <div
                    key={`${c.name}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[11.5px] hover:bg-[var(--bg-hover)]/70"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {c.status === 'failed' ? (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                      )}
                      <span className="truncate text-foreground">{c.name}</span>
                    </span>
                    {c.url && (
                      <button
                        type="button"
                        onClick={() => openGitHubExternal(c.url!)}
                        className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {t('common:github.viewCheck')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {grouped.passed.length > 0 && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowPassedChecks((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {showPassedChecks
                    ? t('common:github.checksHidePassed')
                    : t('common:github.checksShowPassed', { count: grouped.passed.length })}
                </button>
                {showPassedChecks && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {grouped.passed.map((c, idx) => (
                      <div
                        key={`p-${c.name}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 text-[11.5px] text-muted-foreground"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                          <span className="truncate">{c.name}</span>
                        </span>
                        {c.url && (
                          <button
                            type="button"
                            onClick={() => openGitHubExternal(c.url!)}
                            className="shrink-0 text-[10.5px] hover:text-foreground"
                          >
                            {t('common:github.viewCheck')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {pr.body.trim() && (
            <div className="mt-3.5 border-t border-border/50 pt-3 text-[12.5px] leading-relaxed">
              <QuestionnaireMarkdown content={pr.body} compact />
            </div>
          )}

          {/* Review & Comments Discussion Stream */}
          {discussions.length > 0 && (
            <div className="mt-3.5 border-t border-border/50 pt-3">
              <button
                type="button"
                onClick={() => setShowDiscussions((v) => !v)}
                className="flex w-full items-center justify-between text-[11.5px] font-medium text-foreground-secondary hover:text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{t('common:github.discussionsTitle', { count: discussions.length })}</span>
                </span>
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform', showDiscussions && 'rotate-180')}
                />
              </button>
              {showDiscussions && (
                <div className="mt-2 flex flex-col gap-2">
                  {discussions.map((d, idx) => (
                    <div
                      key={`${d.author}-${d.createdAt}-${idx}`}
                      className="rounded-lg border border-border/55 bg-[var(--bg-1)]/40 px-2.5 py-2 text-[11.5px]"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">@{d.author}</span>
                        <div className="flex items-center gap-1.5">
                          {d.reviewState && (
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.2 text-[10px] font-medium',
                                d.reviewState === 'APPROVED'
                                  ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                                  : d.reviewState === 'CHANGES_REQUESTED'
                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                    : 'bg-[var(--bg-2)] text-muted-foreground',
                              )}
                            >
                              {d.reviewState === 'APPROVED'
                                ? t('common:github.approved')
                                : d.reviewState === 'CHANGES_REQUESTED'
                                  ? t('common:github.changesRequested')
                                  : d.reviewState}
                            </span>
                          )}
                          <span>{formatRelativeTime(d.createdAt)}</span>
                        </div>
                      </div>
                      {d.body && (
                        <div className="mt-1 whitespace-pre-wrap break-words text-foreground-secondary leading-relaxed">
                          {d.body}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1.5 border-t border-border/55 bg-[var(--bg-1)]/35 px-3 py-2.5">
          {(hasFailing || hasConflict) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {hasFailing && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() =>
                    void runHandoff(
                      'local',
                      'pr',
                      pr.title,
                      buildPrFixChecksPrompt(pr),
                      pr.headRefName || `pr-${pr.number}`,
                      pr.number,
                      pr.baseRefName,
                    )
                  }
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span>{t('common:github.fixChecksInPi')}</span>
                </button>
              )}
              {hasConflict && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() =>
                    void runHandoff(
                      'local',
                      'pr',
                      pr.title,
                      buildPrResolveConflictsPrompt(pr),
                      pr.headRefName || `pr-${pr.number}`,
                      pr.number,
                      pr.baseRefName,
                    )
                  }
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span>{t('common:github.resolveConflictsInPi')}</span>
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busyAction}
              onClick={() =>
                void runHandoff(
                  'local',
                  'pr',
                  pr.title,
                  buildPrWorkPrompt(pr),
                  pr.headRefName || `pr-${pr.number}`,
                  pr.number,
                  pr.baseRefName,
                )
              }
              className="inline-flex h-7 flex-1 items-center justify-center whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              {t('common:github.workLocal')}
            </button>
            <button
              type="button"
              disabled={busyAction}
              onClick={() =>
                void runHandoff(
                  'worktree',
                  'pr',
                  pr.title,
                  buildPrWorkPrompt(pr),
                  pr.headRefName || `pr-${pr.number}`,
                  pr.number,
                  pr.baseRefName,
                )
              }
              className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2.5 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
              <span>{t('common:github.checkoutPrWorktree')}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── Issue Detail View ── */
  if (selectedIssue) {
    const issue = selectedIssue
    return (
      <div data-pi-slot="github-panel" className="flex h-full min-h-0 flex-col text-[12.5px]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/55 px-3 py-2">
          <button
            type="button"
            onClick={backToList}
            title="Esc"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('common:github.backToList')}</span>
          </button>
          <button
            type="button"
            onClick={() => openGitHubExternal(issue.url)}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <span>{t('common:github.openOnGithub')}</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        <div className="studio-thin-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          <div className="text-[14px] font-semibold leading-snug text-foreground">
            <span className="mr-1.5 font-mono text-muted-foreground">#{issue.number}</span>
            {issue.title}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
            {issue.author && <span>@{issue.author.login}</span>}
            <span>{t('common:github.comments', { count: issue.commentCount })}</span>
            <span>{formatRelativeTime(issue.updatedAt)}</span>
          </div>
          {issue.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <span
                  key={l.name}
                  style={labelBadgeStyle(l.color)}
                  className="rounded-full border border-border/50 bg-[var(--bg-2)] px-2 py-0.5 text-[10.5px] text-foreground-secondary"
                >
                  {l.name}
                </span>
              ))}
            </div>
          )}
          {issue.body.trim() && (
            <div className="mt-3.5 border-t border-border/50 pt-3 text-[12.5px] leading-relaxed">
              <QuestionnaireMarkdown content={issue.body} compact />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-border/55 bg-[var(--bg-1)]/35 px-3 py-2.5">
          <button
            type="button"
            disabled={busyAction}
            onClick={() =>
              void runHandoff(
                'local',
                'issue',
                issue.title,
                buildIssueWorkPrompt(issue),
                `issue-${issue.number}`,
                issue.number,
              )
            }
            className="inline-flex h-7 flex-1 items-center justify-center whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            {t('common:github.workLocal')}
          </button>
          <button
            type="button"
            disabled={busyAction}
            onClick={() =>
              void runHandoff(
                'worktree',
                'issue',
                issue.title,
                buildIssueWorkPrompt(issue),
                `issue-${issue.number}`,
                issue.number,
              )
            }
            className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2.5 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
            <span>{t('common:github.workInWorktree')}</span>
          </button>
        </div>
      </div>
    )
  }

  /* ── List View (SWR zero-flicker + #number direct jump + soft label tinting) ── */
  const listItems = mode === 'prs' ? prs : issues
  const isInitialSkeleton = loading && listItems.length === 0

  return (
    <div data-pi-slot="github-panel" className="flex h-full min-h-0 flex-col text-[12.5px]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/55 px-3 py-2">
        <div className="flex items-center gap-0.5 rounded-md bg-[var(--bg-2)]/75 p-0.5">
          <button
            type="button"
            onClick={() => setMode('prs')}
            className={cn(
              'rounded px-2 py-0.5 text-[11.5px] font-medium transition-colors',
              mode === 'prs'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('common:github.prs')}
          </button>
          <button
            type="button"
            onClick={() => setMode('issues')}
            className={cn(
              'rounded px-2 py-0.5 text-[11.5px] font-medium transition-colors',
              mode === 'issues'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('common:github.issues')}
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-1">
          {repo && (
            <span
              className="max-w-[130px] truncate font-mono text-[11px] text-muted-foreground"
              title={repo.fullName}
            >
              {repo.fullName}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadList(true)}
            title={t('common:github.refresh')}
            aria-label={t('common:github.refresh')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/45 px-3 py-2">
        <div className="flex items-center gap-1">
          {(['open', 'closed', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStateFilter(s)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                stateFilter === s
                  ? 'bg-[var(--bg-active)] font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
              )}
            >
              {t(`common:github.${s}`)}
            </button>
          ))}
          <select
            value={involvement}
            onChange={(e) => setInvolvement(e.target.value as InvolvementFilter)}
            className="ml-auto h-6 rounded-md border border-transparent bg-transparent px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-[var(--bg-hover)] hover:text-foreground focus:border-border"
          >
            <option value="all">{t('common:github.everyone')}</option>
            <option value="involved">{t('common:github.involved')}</option>
            <option value="authored">{t('common:github.authored')}</option>
            <option value="assigned">{t('common:github.assigned')}</option>
          </select>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && mode === 'prs') {
                const m = searchText.trim().match(/^#?(\d+)$/)
                if (m) {
                  e.preventDefault()
                  void openPrDetailByNumber(Number(m[1]))
                }
              }
            }}
            placeholder={t('common:github.searchPlaceholder')}
            className="h-7 w-full rounded-md border border-border/65 bg-background pl-7 pr-2 text-[11.5px] text-foreground outline-none focus:border-[var(--brand)]"
          />
        </div>
      </div>

      <div
        ref={listScrollRef}
        className={cn(
          'studio-thin-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5 transition-opacity duration-150',
          loading && listItems.length > 0 && 'opacity-70',
        )}
      >
        {errorCode === 'not-git' || errorCode === 'not-github' ? (
          <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
            {t('common:github.noRepo')}
          </div>
        ) : errorCode === 'no-auth' ? (
          <div className="px-4 py-10 text-center text-[12px] leading-relaxed text-muted-foreground">
            {t('common:github.noAuth')}
          </div>
        ) : errorCode === 'api-error' ? (
          <div className="px-4 py-8 text-center text-[12px] text-destructive">
            {errorMsg || t('common:operationFailed')}
          </div>
        ) : isInitialSkeleton ? (
          <div className="flex flex-col gap-1.5 px-1.5 py-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--bg-hover)]/65" />
            ))}
          </div>
        ) : mode === 'prs' ? (
          prs.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
              {t('common:github.emptyPrs')}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {prs.map((pr) => (
                <button
                  key={pr.number}
                  type="button"
                  onClick={() => void openPrDetailByNumber(pr.number, pr)}
                  className="pi-virtual-row flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]/75"
                >
                  <GitFork
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      pr.state === 'merged'
                        ? 'text-violet-500'
                        : pr.state === 'closed'
                          ? 'text-muted-foreground'
                          : pr.isDraft
                            ? 'text-muted-foreground'
                            : 'text-emerald-600 dark:text-emerald-400',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium leading-snug text-foreground">
                      {pr.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">#{pr.number}</span>
                      {pr.author && <span className="truncate">{pr.author.login}</span>}
                      <span className="max-w-[110px] truncate font-mono opacity-80">{pr.headRefName}</span>
                      {pr.labels.slice(0, 2).map((l) => (
                        <span
                          key={l.name}
                          style={labelBadgeStyle(l.color)}
                          className="rounded-full border border-border/45 bg-[var(--bg-2)] px-1.5 text-[10px] text-foreground-secondary"
                        >
                          {l.name}
                        </span>
                      ))}
                      {pr.commentCount > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <MessageSquare className="h-2.5 w-2.5" />
                          {pr.commentCount}
                        </span>
                      )}
                      <span className="ml-auto shrink-0">{formatRelativeTime(pr.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="mt-0.5 flex shrink-0 items-center gap-1">
                    {pr.mergeable === 'CONFLICTING' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    <ChecksGlyph state={pr.checksState} />
                  </div>
                </button>
              ))}
            </div>
          )
        ) : issues.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
            {t('common:github.emptyIssues')}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {issues.map((issue) => (
              <button
                key={issue.number}
                type="button"
                onClick={() => {
                  savedScrollTopRef.current = listScrollRef.current?.scrollTop ?? 0
                  setSelectedIssue(issue)
                }}
                className="pi-virtual-row flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]/75"
              >
                <CircleDot
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 shrink-0',
                    issue.state === 'closed'
                      ? 'text-violet-500'
                      : 'text-emerald-600 dark:text-emerald-400',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium leading-snug text-foreground">
                    {issue.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="font-mono">#{issue.number}</span>
                    {issue.author && <span className="truncate">{issue.author.login}</span>}
                    {issue.labels.slice(0, 2).map((l) => (
                      <span
                        key={l.name}
                        style={labelBadgeStyle(l.color)}
                        className="rounded-full border border-border/45 bg-[var(--bg-2)] px-1.5 text-[10px] text-foreground-secondary"
                      >
                        {l.name}
                      </span>
                    ))}
                    {issue.commentCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <MessageSquare className="h-2.5 w-2.5" />
                        {issue.commentCount}
                      </span>
                    )}
                    <span className="ml-auto shrink-0">{formatRelativeTime(issue.updatedAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
