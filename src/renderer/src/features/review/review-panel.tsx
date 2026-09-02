import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { Columns2, Rows2, Loader2, RefreshCw } from '@renderer/components/icons'
import { FileDiffView, ReviewCommitBar, type DiffMode } from './review-diff-views'
import { useReviewGitData } from './use-review-git-data'
import {
  collectTouchedPaths,
  filterReviewGroups,
  groupReviewFiles,
  type ReviewFileRow,
} from './review-git-utils'

const SCOPES = ['turn', 'session', 'git'] as const
type Scope = (typeof SCOPES)[number]

/** 已消费的打开意图 seq（模块级：面板卸载重挂不会重复消费） */
let consumedReviewIntentSeq = 0

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
  /** 焦点请求令牌：每次「在 Git Review 中查看」+1，已挂载的 FileDiffView 据此重新展开 */
  const [focusToken, setFocusToken] = useState(0)
  /** 文件列表滚动容器：焦点跳转时把目标滚动到中上位置 */
  const listScrollRef = useRef<HTMLDivElement>(null)
  const panelOpenIntent = useUIStore((s) => s.panelOpenIntent)
  const { gitData, loading, refreshing, refresh: loadGit } = useReviewGitData({
    enabled: true,
    workspace,
    worktreeChangeSignal: fileChanges,
  })

  const turnRunId = running ? activeRunId : lastRunId
  const cwd = workspace || ''

  useEffect(() => {
    const saved = localStorage.getItem('reviewDiffMode')
    if (saved === 'split' || saved === 'inline') setDiffMode(saved)
  }, [])

  useEffect(() => {
    // 打开意图在 store 中持久，懒加载挂载后消费一次（模块级 seq 防重入）
    if (!panelOpenIntent || panelOpenIntent.panel !== 'review') return
    if (panelOpenIntent.seq === consumedReviewIntentSeq) return
    consumedReviewIntentSeq = panelOpenIntent.seq
    if (panelOpenIntent.scope && SCOPES.includes(panelOpenIntent.scope)) {
      setScope(panelOpenIntent.scope)
    }
    if (panelOpenIntent.path) {
      const normalized = panelOpenIntent.path.replace(/\\/g, '/')
      setFocusPath(normalized)
      setExpandedPath(normalized)
      setFocusToken((prev) => prev + 1)
    }
  }, [panelOpenIntent])

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
      setFocusToken((prev) => prev + 1)
    }
    window.addEventListener('pi-desktop:review-focus-file', onFocus)
    return () => window.removeEventListener('pi-desktop:review-focus-file', onFocus)
  }, [])

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
            focusToken={focusToken}
            focusScrollRef={listScrollRef}
            onMutated={loadGit}
          />
        ))}
      </section>
    )
  }

  const empty = groups.staged.length === 0 && groups.unstaged.length === 0 && groups.cleanTouched.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border/40 px-2 py-1.5">
        {SCOPES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setScope(item)}
            className={cn(
              'h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors',
              scope === item
                ? 'bg-[var(--bg-active)] text-foreground'
                : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
            )}
          >
            {t(`review.scope.${item}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <span className="truncate text-[10px] text-foreground-secondary/80">{scopeHint}</span>
        <div className="flex items-center gap-1">
          {groups.staged.length + groups.unstaged.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = diffMode === 'inline' ? 'split' : 'inline'
                setDiffMode(next)
                localStorage.setItem('reviewDiffMode', next)
              }}
              className="chrome-icon-btn rounded p-1"
              title={diffMode === 'inline' ? t('review:toggleSplit') : t('review:toggleInline')}
            >
              {diffMode === 'inline' ? <Columns2 className="h-3 w-3" /> : <Rows2 className="h-3 w-3" />}
            </button>
          )}
          <button type="button" onClick={loadGit} className="chrome-icon-btn rounded p-1" title={t('review:refresh')}>
            <RefreshCw className={cn('h-3 w-3', (loading || refreshing) && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div className="scrollbar-overlay flex-1 overflow-y-auto" ref={listScrollRef}>
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
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-[12px] text-foreground-secondary/70">{t('review:empty')}</p>
            {scope === 'git' && (
              <p className="max-w-[240px] text-[11px] text-muted-foreground/60">{t('review:emptyGitHint')}</p>
            )}
          </div>
        ) : (
          <div className="py-1">
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
      {gitData?.isRepo !== false && groups.staged.length > 0 ? (
        <ReviewCommitBar cwd={cwd} onCommitted={loadGit} />
      ) : null}
    </div>
  )
}
