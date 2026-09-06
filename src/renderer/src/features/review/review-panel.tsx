import { useState, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { Columns2, Rows2, Loader2, RefreshCw, GitBranch, GitCommitHorizontal, Sparkles } from '@renderer/components/icons'
import { FileDiffView, ReviewCommitBar, type DiffMode } from './review-diff-views'
import { useReviewGitData } from './use-review-git-data'
import {
  collectTouchedPaths,
  filterReviewGroups,
  groupReviewFiles,
  listConflictPaths,
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

export function ReviewPanel() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('session')
  const fileChanges = useUIStore((s) => s.fileChanges)
  const timelineItems = useUIStore((s) => s.timelineItems)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const lastRunId = useUIStore((s) => s.runState.lastRunId)
  const running = useUIStore((s) => s.runState.status === 'running')
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('inline')
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
    const saved = localStorage.getItem('reviewDiffMode')
    if (saved === 'split' || saved === 'inline') setDiffMode(saved)
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

  const groups = useMemo(() => {
    const all = groupReviewFiles({
      status: gitData?.status || '',
      unstagedRaw: gitData?.raw || '',
      stagedRaw: gitData?.stagedRaw || '',
    })
    if (scope === 'git') return all
    if (scope === 'turn' && !turnRunId) return { staged: [], unstaged: [], cleanTouched: [] }
    const tools = timelineItems
      .filter((item) => item.type === 'tool-call')
      .map((item) => ({
        toolName: item.toolName,
        runId: item.runId,
        toolDetail: item.toolDetail,
        toolArgs: item.toolArgs,
      }))
    return filterReviewGroups(all, collectTouchedPaths(fileChanges, tools, scope === 'turn' ? turnRunId : null))
  }, [gitData?.status, gitData?.raw, gitData?.stagedRaw, scope, fileChanges, timelineItems, turnRunId])

  const scopeHint =
    scope === 'turn'
      ? turnRunId
        ? t('review:scopeHintTurn', { id: turnRunId.slice(0, 8) })
        : t('review:scopeHintNoTurn')
      : scope === 'session'
        ? t('review:scopeHintSession', { count: groups.staged.length + groups.unstaged.length })
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

  const renderGroup = (title: string, rows: ReviewFileRow[], group: 'staged' | 'unstaged') => {
    if (rows.length === 0) return null
    return (
      <section>
        <div className="px-3 py-1.5 text-[10px] font-medium tracking-wide text-foreground-secondary/70">
          {title} · {rows.length}
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
            onMutated={loadGit}
          />
        ))}
      </section>
    )
  }

  const empty = groups.staged.length === 0 && groups.unstaged.length === 0 && groups.cleanTouched.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="review-toolbar flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex min-w-0 flex-1 gap-1" role="group" aria-label={t('review:title')}>
        {SCOPES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setScope(item)}
            aria-pressed={scope === item}
            className="workbench-scope whitespace-nowrap"
          >
            {t(`review:scope.${item}`)}
          </button>
        ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {groups.staged.length + groups.unstaged.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = diffMode === 'inline' ? 'split' : 'inline'
                setDiffMode(next)
                localStorage.setItem('reviewDiffMode', next)
              }}
              className="workbench-icon"
              aria-label={diffMode === 'inline' ? t('review:toggleSplit') : t('review:toggleInline')}
              aria-pressed={diffMode === 'split'}
              title={diffMode === 'inline' ? t('review:toggleSplit') : t('review:toggleInline')}
            >
              {diffMode === 'inline' ? <Columns2 className="h-3 w-3" /> : <Rows2 className="h-3 w-3" />}
            </button>
          )}
          <button type="button" onClick={loadGit} className="workbench-icon" title={t('review:refresh')} aria-label={t('review:refresh')} disabled={loading || refreshing}>
            <RefreshCw className={cn('h-3 w-3', (loading || refreshing) && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div className="flex min-h-8 items-center gap-2 px-4 text-xs text-foreground-secondary"><GitBranch className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={scopeHint}>{scopeHint}</span></div>
      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : gitData?.isRepo === false ? (
          <div className="px-4 py-10 text-center text-[12px] leading-relaxed text-foreground-secondary">
            {gitData.message || t('review:notGitRepo')}
            <div className="mt-1 text-[11px] text-muted-foreground/60">{t('review:notGitHint')}</div>
          </div>
        ) : gitData?.error ? (
          <p className="px-3 py-4 text-[11px] text-destructive/80">{gitData.error}</p>
        ) : empty ? (
          <p className="px-4 py-10 text-center text-[12px] text-foreground-secondary/70">{t('review:empty')}</p>
        ) : (
          <div className="py-1">
            {conflicts.length > 0 ? (
              <section>
                <div className="px-3 py-1.5 text-[10px] font-medium tracking-wide text-destructive/80">
                  {t('review:conflicts')} · {conflicts.length}
                </div>
                {conflicts.map((path) => (
                  <div key={path} className="px-3 py-1.5 font-mono text-[11px] text-destructive/80">{path}</div>
                ))}
              </section>
            ) : null}
            {renderGroup(t('review:staged'), groups.staged, 'staged')}
            {renderGroup(t('review:unstaged'), groups.unstaged, 'unstaged')}
            {groups.cleanTouched.length > 0 ? (
              <section>
                <div className="px-3 py-1.5 text-[10px] font-medium tracking-wide text-foreground-secondary/70">
                  {t('review:cleanTouched')} · {groups.cleanTouched.length}
                </div>
                {groups.cleanTouched.map((path) => (
                  <div key={path} className="px-3 py-1.5 font-mono text-[11px] text-foreground-secondary/70">
                    {path}
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </div>
      {gitData?.isRepo === true && !gitData.error ? (
        <div className="review-actions shrink-0 space-y-3 border-t border-border/60 bg-[var(--bg-base)] px-4 py-3">
          {sendError && <p role="alert" className="text-xs text-destructive">{t('review:sendFailed')}</p>}
          {(commentCount > 0 || conflicts.length > 0) && <section className="space-y-2 border-b border-border/40 pb-3">
            <div className="text-xs font-medium text-foreground-secondary">{t('review:collaboration')}</div>
            <div className="flex flex-wrap gap-2">
              {commentCount > 0 && <button type="button" className="workbench-button bg-primary/10 text-primary" disabled={sending} onClick={() => void sendPrompt(t('review:commentsPrompt', { comments: formatReviewCommentsForPrompt(cwd) }), true)}>{t('review:sendComments')} <span className="tabular-nums opacity-70">{commentCount}</span></button>}
              {conflicts.length > 0 && <button type="button" className="workbench-button text-destructive" disabled={sending} onClick={() => void sendPrompt(t('review:conflictsPrompt', { files: conflicts.map((p) => `- ${p}`).join('\n') }))}>{t('review:sendConflicts')}</button>}
            </div>
          </section>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-medium text-foreground-secondary"><GitCommitHorizontal className="h-3.5 w-3.5" />{t('review:commitTitle')}</span>
            <button type="button" className="workbench-button" disabled={sending || !gitData.stagedRaw} title={!gitData.stagedRaw ? t('review:stageFirst') : t('review:generateMessage')} onClick={() => void sendPrompt(t('review:generatePrompt', { diff: (gitData.stagedRaw || '').slice(0, 8000) }))}><Sparkles className="h-3.5 w-3.5" />{t('review:generateShort')}</button>
          </div>
          {groups.staged.length > 0 ? <ReviewCommitBar cwd={cwd} onCommitted={loadGit} /> : <p className="text-xs leading-relaxed text-foreground-secondary">{t('review:stageFirst')}</p>}
        </div>
      ) : null}
    </div>
  )
}
