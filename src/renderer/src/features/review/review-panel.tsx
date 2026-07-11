import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { parseGitDiff } from '@shared/diff-model'
import {
  Copy,
  Check,
  GitBranch,
  Loader2,
  FileDiff,
  RefreshCw,
  Columns2,
  Rows2,
} from 'lucide-react'
import { parseGitStatus } from './review-git-utils'
import { ChangeIcon, FileDiffView, ReviewCommitBar, type DiffMode } from './review-diff-views'

type AnyFileEntry = {
  path: string
  changeType: string
  staged?: boolean
  source?: string
  runId?: string
  turnId?: string
}

const SCOPES = ['turn', 'session', 'git'] as const
type Scope = (typeof SCOPES)[number]

export function ReviewPanel() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('session')
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const lastRunId = useUIStore((s) => s.runState.lastRunId)
  const running = useUIStore((s) => s.runState.status === 'running')
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [gitData, setGitData] = useState<{
    files: { path: string; changeType: string }[]
    raw: string
    branch?: string
    log?: string
    error?: string
    isRepo?: boolean
    message?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedGitPath, setExpandedGitPath] = useState<string | null>(null)
  const [focusGitPath, setFocusGitPath] = useState<string | null>(null)
  const [expandedMetaPath, setExpandedMetaPath] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('inline')
  const [gitReloadKey, setGitReloadKey] = useState(0)

  const turnRunId = running ? activeRunId : lastRunId

  useEffect(() => {
    const saved = localStorage.getItem('reviewDiffMode')
    if (saved === 'split' || saved === 'inline') setDiffMode(saved)
  }, [])

  const toggleDiffMode = () => {
    const next = diffMode === 'inline' ? 'split' : 'inline'
    setDiffMode(next)
    localStorage.setItem('reviewDiffMode', next)
  }

  useEffect(() => {
    const onScope = (e: Event) => {
      const s = (e as CustomEvent<Scope>).detail
      if (s && SCOPES.includes(s)) setScope(s)
    }
    window.addEventListener('pi-desktop:review-scope', onScope)
    return () => window.removeEventListener('pi-desktop:review-scope', onScope)
  }, [])

  useEffect(() => {
    const onFocus = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path
      if (path) {
        const normalized = path.replace(/\\/g, '/')
        setFocusGitPath(normalized)
        setExpandedGitPath(normalized)
        setExpandedMetaPath(normalized)
      }
    }
    window.addEventListener('pi-desktop:review-focus-file', onFocus)
    return () => window.removeEventListener('pi-desktop:review-focus-file', onFocus)
  }, [])

  const loadGit = () => {
    if (!workspace) return
    setLoading(true)
    setGitReloadKey((k) => k + 1)
    ipcClient
      .invoke('review.getDiff', { sessionId: '', scope: 'git' })
      .then((res) => {
        if (res?.diff) {
          const isRepo = res.diff.isRepo !== false
          setGitData({
            files: parseGitStatus(res.diff.status || ''),
            raw: res.diff.raw || '',
            branch: res.diff.branch,
            log: res.diff.log,
            isRepo,
            message: res.diff.message,
            error: isRepo ? res.diff.error : undefined,
          })
        }
      })
      .catch(() => setGitData(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (scope === 'git' && workspace) loadGit()
  }, [scope, workspace])

  useEffect(() => {
    return onGitWorkspaceChanged((payload) => {
      if (!workspace || payload.cwd.replace(/\\/g, '/') !== workspace.replace(/\\/g, '/')) return
      if (scope === 'git') loadGit()
    })
  }, [scope, workspace])

  const turnFiles = useMemo(
    () => fileChanges.filter((f) => turnRunId && f.runId === turnRunId),
    [fileChanges, turnRunId],
  )

  const files: AnyFileEntry[] =
    scope === 'git' ? (gitData?.files as AnyFileEntry[]) || [] : scope === 'turn' ? turnFiles : fileChanges

  const diffFiles = useMemo(() => {
    if (scope !== 'git' || !gitData?.raw) return []
    return parseGitDiff(gitData.raw)
  }, [scope, gitData?.raw])

  const cwd = workspace || ''

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 1500)
  }

  const scopeHint =
    scope === 'turn'
      ? turnRunId
        ? `本轮 run ${turnRunId.slice(0, 8)}…`
        : '尚无本轮（发一条消息后可见）'
      : scope === 'session'
        ? `本对话累计 ${fileChanges.length} 个文件`
        : gitData?.isRepo === false
          ? '非 Git 仓库'
          : gitData?.branch
            ? `分支 ${gitData.branch}`
            : 'Git 工作区'

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border/80">
        {SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              'flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors',
              scope === s ? 'bg-[var(--bg-active)] text-foreground' : 'text-foreground-secondary hover:bg-[var(--bg-hover)]',
            )}
          >
            {t(`review.scope.${s}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <span className="truncate text-[10px] text-foreground-secondary/80">{scopeHint}</span>
        <div className="flex items-center gap-1">
          {scope === 'git' && diffFiles.length > 0 && (
            <button
              type="button"
              onClick={toggleDiffMode}
              className="chrome-icon-btn rounded p-1"
              title={diffMode === 'inline' ? '切换到并排视图' : '切换到内联视图'}
            >
              {diffMode === 'inline' ? <Columns2 className="h-3 w-3" /> : <Rows2 className="h-3 w-3" />}
            </button>
          )}
          {scope === 'git' && (
            <button type="button" onClick={loadGit} className="chrome-icon-btn rounded p-1" title="刷新">
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            </button>
          )}
        </div>
      </div>
      <div className="scrollbar-overlay flex-1 overflow-y-auto">
        {scope === 'git' && gitData?.log && (
          <div className="border-b border-border/40 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-foreground-secondary/70">
              <GitBranch className="h-3 w-3" />
              最近提交
            </div>
            <pre className="max-h-28 overflow-y-auto font-mono text-[10px] leading-relaxed text-foreground-secondary/90">
              {gitData.log}
            </pre>
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : scope === 'git' && gitData?.isRepo === false ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <GitBranch className="h-8 w-8 text-muted-foreground/25" />
            <span className="text-[12px] text-foreground-secondary">
              {gitData.message || '当前目录不是 Git 仓库'}
            </span>
            <span className="text-[11px] text-muted-foreground/50">临时对话或未初始化的文件夹通常没有 Git</span>
          </div>
        ) : scope === 'git' && gitData?.error ? (
          <p className="px-3 py-4 text-[11px] text-destructive/80">{gitData.error}</p>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <FileDiff className="h-8 w-8 text-muted-foreground/25" />
            <span className="text-[11px] text-muted-foreground/40">{t('review:empty')}</span>
          </div>
        ) : scope === 'git' ? (
          <div className="py-1">
            {files.map((fc) => {
              const file = diffFiles.find((d) => d.path === fc.path || fc.path.endsWith(d.path))
              return (
                <FileDiffView
                  key={`${fc.path}-${gitReloadKey}`}
                  file={file}
                  fallbackPath={fc.path}
                  fallbackChangeType={fc.changeType}
                  staged={fc.staged ?? false}
                  mode={diffMode}
                  cwd={cwd}
                  defaultOpen={(() => {
                    const n = (p: string) => p.replace(/\\/g, '/')
                    const fp = focusGitPath ? n(focusGitPath) : null
                    const cp = n(fc.path)
                    return expandedGitPath === fc.path || (fp != null && (cp === fp || cp.endsWith(`/${fp}`)))
                  })()}
                />
              )
            })}
          </div>
        ) : (
          <div className="py-1.5">
            {files.map((fc) => {
              const open =
                expandedMetaPath === fc.path ||
                (!!focusGitPath &&
                  (fc.path.replace(/\\/g, '/') === focusGitPath ||
                    fc.path.replace(/\\/g, '/').endsWith(`/${focusGitPath}`)))
              return (
                <div key={`${fc.path}-${fc.runId || ''}`} className="group">
                  <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)]">
                    <ChangeIcon type={fc.changeType} />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left font-mono text-[11px]"
                      onClick={() => setExpandedMetaPath(open ? null : fc.path)}
                    >
                      {fc.path}
                    </button>
                    <span className="text-[9px] text-foreground-secondary/50">{fc.source}</span>
                    <button type="button" onClick={() => handleCopy(fc.path)} className="opacity-0 group-hover:opacity-100">
                      {copiedPath === fc.path ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-border/20 bg-[var(--bg-2)]/50 px-3 py-2 text-[10px] text-foreground-secondary">
                      {fc.changeType} · {fc.source}
                      {fc.runId && <span className="ml-2 font-mono">run {fc.runId.slice(0, 8)}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {scope === 'git' && gitData?.isRepo !== false && files.length > 0 && (
        <ReviewCommitBar cwd={cwd} onCommitted={loadGit} />
      )}
    </div>
  )
}