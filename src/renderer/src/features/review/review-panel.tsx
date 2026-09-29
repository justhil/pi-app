import { useState, useEffect, useMemo, useSyncExternalStore, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import {
  Columns2,
  Rows2,
  RefreshCw,
  GitBranch,
  Maximize2,
  Minus,
  FileEdit,
  AlertCircle,
  Send,
} from '@renderer/components/icons'
import { FileDiffView, type DiffMode } from './review-diff-views'
import { useReviewGitData } from './use-review-git-data'
import {
  collectTouchedPaths,
  filterReviewGroups,
  groupReviewFiles,
  listConflictPaths,
  type ReviewFileGroups,
  type ReviewFileRow,
} from './review-git-utils'
import {
  clearReviewComments,
  formatReviewCommentsForPrompt,
  listAllReviewComments,
  subscribeReviewComments,
} from './review-inline-comments'
import { sendComposerPrompt } from '@renderer/lib/send-composer-prompt'

const SCOPES = ['turn', 'session', 'git'] as const
type Scope = (typeof SCOPES)[number]
type ToolTouchRow = { toolName?: string; runId?: string; toolDetail?: unknown; toolArgs?: unknown }

const EMPTY_GROUPS: ReviewFileGroups = { staged: [], unstaged: [], cleanTouched: [] }
let memoItems: TimelineItem[] | null = null
let memoSignature = ''
let memoRows: ToolTouchRow[] = []

/**
 * Tool rows that can touch files, as a stable array: streaming text rebuilds `timelineItems`
 * every token, but the file scopes only change when a tool row appears or finishes.
 */
function selectToolTouchRows(items: TimelineItem[]): ToolTouchRow[] {
  if (items === memoItems) return memoRows
  memoItems = items
  const tools = items.filter((item) => item.type === 'tool-call')
  const signature = tools.map((item) => `${item.id}:${item.toolPhase ?? ''}:${item.runId ?? ''}`).join('|')
  if (signature !== memoSignature) {
    memoSignature = signature
    memoRows = tools.map((item) => ({
      toolName: item.toolName,
      runId: item.runId,
      toolDetail: item.toolDetail,
      toolArgs: item.toolArgs,
    }))
  }
  return memoRows
}

function totals(groups: ReviewFileGroups): { files: number; additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const row of [...groups.staged, ...groups.unstaged]) {
    additions += row.file?.additions ?? 0
    deletions += row.file?.deletions ?? 0
  }
  return { files: groups.staged.length + groups.unstaged.length, additions, deletions }
}

function ReviewSkeleton() {
  return (
    <div className="review-skeleton py-2" aria-hidden>
      {[72, 54, 64, 40].map((width, index) => (
        <div key={index} className="flex items-center gap-2 px-3 py-2">
          <span className="h-3 w-3 rounded-sm" />
          <span className="h-2.5 rounded-full" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  )
}

export function ReviewPanel() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('session')
  const fileChanges = useUIStore((s) => s.fileChanges)
  const tools = useUIStore((s) => selectToolTouchRows(s.timelineItems))
  const workspace = useUIStore((s) => s.currentWorkspace)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const lastRunId = useUIStore((s) => s.runState.lastRunId)
  const running = useUIStore((s) => s.runState.status === 'running')
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('inline')
  const [bulk, setBulk] = useState<{ open: boolean } | null>(null)
  const { gitData, loading, refreshing, refresh: loadGit } = useReviewGitData({
    enabled: true,
    workspace,
    worktreeChangeSignal: fileChanges,
  })

  const turnRunId = running ? activeRunId : lastRunId
  const cwd = workspace || ''
  const commentCount = useSyncExternalStore(subscribeReviewComments, () => listAllReviewComments(cwd).length)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const sendPrompt = async (text: string, clearComments = false) => {
    const sent = clearComments ? listAllReviewComments(cwd) : undefined
    setSending(true)
    setSendError(false)
    try {
      if (!await sendComposerPrompt(text)) { setSendError(true); return }
      if (sent) clearReviewComments(cwd, sent)
    } catch {
      setSendError(true)
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem('reviewDiffMode')
      if (saved === 'split' || saved === 'inline') setDiffMode(saved)
    } catch {
      /* storage unavailable */
    }
  }, [])

  useEffect(() => {
    const onScope = (e: Event) => {
      const next = (e as CustomEvent<Scope>).detail
      if (next && SCOPES.includes(next)) setScope(next)
    }
    window.addEventListener('pi-desktop:review-scope', onScope)
    return () => window.removeEventListener('pi-desktop:review-scope', onScope)
  }, [])

  useEffect(() => {
    const onFocus = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path
      if (!path) return
      const normalized = path.replace(/\\/g, '/')
      setFocusPath(normalized)
      setExpandedPath(normalized)
    }
    window.addEventListener('pi-desktop:review-focus-file', onFocus)
    return () => window.removeEventListener('pi-desktop:review-focus-file', onFocus)
  }, [])

  const conflicts = useMemo(() => listConflictPaths(gitData?.status || ''), [gitData?.status])

  const allGroups = useMemo(
    () =>
      groupReviewFiles({
        status: gitData?.status || '',
        unstagedRaw: gitData?.raw || '',
        stagedRaw: gitData?.stagedRaw || '',
      }),
    [gitData?.status, gitData?.raw, gitData?.stagedRaw],
  )
  const groupsByScope = useMemo<Record<Scope, ReviewFileGroups>>(() => {
    const session = filterReviewGroups(allGroups, collectTouchedPaths(fileChanges, tools, null))
    const turn = turnRunId
      ? filterReviewGroups(allGroups, collectTouchedPaths(fileChanges, tools, turnRunId))
      : EMPTY_GROUPS
    return { git: allGroups, session, turn }
  }, [allGroups, fileChanges, tools, turnRunId])
  const groups = groupsByScope[scope]
  const summary = useMemo(() => totals(groups), [groups])

  const scopeHint =
    scope === 'turn'
      ? turnRunId
        ? t('review:scopeHintTurn', { id: turnRunId.slice(0, 8) })
        : t('review:scopeHintNoTurn')
      : scope === 'session'
        ? t('review:scopeHintSession', { count: summary.files })
        : gitData?.isRepo === false
          ? t('review:scopeHintNotRepo')
          : gitData?.branch
            ? t('review:scopeHintBranch', { branch: gitData.branch })
            : t('review:scopeHintGit')

  const isFocused = (path: string) => {
    const n = path.replace(/\\/g, '/')
    const focus = focusPath || expandedPath
    return !!focus && (n === focus || n.endsWith(`/${focus}`) || focus.endsWith(`/${n}`))
  }

  const toggleDiffMode = useCallback(() => {
    setDiffMode((previous) => {
      const next = previous === 'inline' ? 'split' : 'inline'
      try {
        localStorage.setItem('reviewDiffMode', next)
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }, [])

  const renderGroup = (title: string, rows: ReviewFileRow[], group: 'staged' | 'unstaged') => {
    if (rows.length === 0) return null
    return (
      <section className="review-group">
        <div className="review-group-header">
          <span>{title}</span>
          <span className="tabular-nums">{rows.length}</span>
        </div>
        {rows.map((row) => (
          <FileDiffView
            key={`${group}:${row.path}`}
            file={row.file}
            fallbackPath={row.path}
            fallbackChangeType={row.changeType}
            group={group}
            mode={diffMode}
            cwd={cwd}
            defaultOpen={isFocused(row.path)}
            bulk={bulk}
            onMutated={loadGit}
          />
        ))}
      </section>
    )
  }

  const empty = groups.staged.length === 0 && groups.unstaged.length === 0 && groups.cleanTouched.length === 0
  const hasDiffs = summary.files > 0
  const allOpen = bulk?.open === true

  return (
    <div className="review-panel flex h-full flex-col">
      <div className="review-toolbar flex items-center gap-1.5 border-b border-border/40 px-3 py-2">
        <div className="review-scope-group flex min-w-0 flex-1" role="group" aria-label={t('review:title')}>
          {SCOPES.map((item) => {
            const count = totals(groupsByScope[item]).files
            return (
              <button
                key={item}
                type="button"
                onClick={() => setScope(item)}
                aria-pressed={scope === item}
                aria-label={t(`review:scope.${item}`)}
                title={t(`review:scope.${item}`)}
                className="review-scope"
              >
                <span className="min-w-0 truncate">{t(`review:scopeShort.${item}`)}</span>
                {count > 0 ? <span className="review-scope-count tabular-nums">{count}</span> : null}
              </button>
            )
          })}
        </div>
        <button type="button" onClick={loadGit} className="workbench-icon shrink-0" title={t('review:refresh')} aria-label={t('review:refresh')} disabled={loading || refreshing}>
          <RefreshCw className={cn('h-3 w-3', (loading || refreshing) && 'animate-spin')} />
        </button>
      </div>
      <div className="review-summary flex min-h-9 items-center gap-2 border-b border-border/25 px-4 text-[11.5px] text-foreground-secondary">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={scopeHint}>{scopeHint}</span>
        {hasDiffs ? (
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
            <span className="text-[var(--diff-added)]">+{summary.additions}</span>
            <span className="text-[var(--diff-removed)]">−{summary.deletions}</span>
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5">
          {hasDiffs && (
            <>
              <button
                type="button"
                onClick={() => setBulk({ open: !allOpen })}
                className="workbench-icon"
                aria-label={allOpen ? t('review:collapseAll') : t('review:expandAll')}
                title={allOpen ? t('review:collapseAll') : t('review:expandAll')}
              >
                {allOpen ? <Minus className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={toggleDiffMode}
                className="workbench-icon"
                aria-label={diffMode === 'inline' ? t('review:toggleSplit') : t('review:toggleInline')}
                aria-pressed={diffMode === 'split'}
                title={diffMode === 'inline' ? t('review:toggleSplit') : t('review:toggleInline')}
              >
                {diffMode === 'inline' ? <Columns2 className="h-3 w-3" /> : <Rows2 className="h-3 w-3" />}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto" key={scope}>
        <div className="review-scope-body">
          {loading ? (
            <ReviewSkeleton />
          ) : gitData?.isRepo === false ? (
            <div className="review-empty">
              <GitBranch className="h-5 w-5" strokeWidth={1.5} />
              <p className="review-empty-title">{gitData.message || t('review:notGitRepo')}</p>
              <p className="review-empty-hint">{t('review:notGitHint')}</p>
            </div>
          ) : gitData?.error ? (
            <p className="px-3 py-4 text-[11px] text-destructive/80">{gitData.error}</p>
          ) : empty ? (
            <div className="review-empty">
              <FileEdit className="h-5 w-5" strokeWidth={1.5} />
              <p className="review-empty-title">{t('review:empty')}</p>
              <p className="review-empty-hint">{t(`review:emptyHint.${scope}`)}</p>
            </div>
          ) : (
            <div className="pb-2">
              {conflicts.length > 0 ? (
                <section className="review-group">
                  <div className="review-group-header text-destructive/85">
                    <span className="flex items-center gap-1.5"><AlertCircle className="h-3 w-3" />{t('review:conflicts')}</span>
                    <span className="tabular-nums">{conflicts.length}</span>
                  </div>
                  {conflicts.map((path) => (
                    <div key={path} className="truncate px-3 py-1.5 font-mono text-[11px] text-destructive/80" title={path}>{path}</div>
                  ))}
                </section>
              ) : null}
              {renderGroup(t('review:staged'), groups.staged, 'staged')}
              {renderGroup(t('review:unstaged'), groups.unstaged, 'unstaged')}
              {groups.cleanTouched.length > 0 ? (
                <section className="review-group">
                  <div className="review-group-header">
                    <span>{t('review:cleanTouched')}</span>
                    <span className="tabular-nums">{groups.cleanTouched.length}</span>
                  </div>
                  {groups.cleanTouched.map((path) => (
                    <div key={path} className="truncate px-3 py-1.5 font-mono text-[11px] text-foreground-secondary/70" title={path}>
                      {path}
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
      {gitData?.isRepo === true && !gitData.error && (commentCount > 0 || conflicts.length > 0 || sendError) ? (
        <div className="review-actions shrink-0 space-y-2 border-t border-border/60 bg-[var(--bg-base)] px-4 py-3">
          {sendError && <p role="alert" className="text-xs text-destructive">{t('review:sendFailed')}</p>}
          <div className="text-[11.5px] font-medium text-foreground-secondary">{t('review:collaboration')}</div>
          <div className="flex flex-wrap gap-2">
            {commentCount > 0 && (
              <button
                type="button"
                className="workbench-button bg-primary/10 text-primary"
                disabled={sending}
                onClick={() => void sendPrompt(t('review:commentsPrompt', { comments: formatReviewCommentsForPrompt(cwd) }), true)}
              >
                <Send className="h-3.5 w-3.5" />
                {t('review:sendComments')} <span className="tabular-nums opacity-70">{commentCount}</span>
              </button>
            )}
            {conflicts.length > 0 && (
              <button
                type="button"
                className="workbench-button text-destructive"
                disabled={sending}
                onClick={() => void sendPrompt(t('review:conflictsPrompt', { files: conflicts.map((p) => `- ${p}`).join('\n') }))}
              >
                {t('review:sendConflicts')}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
