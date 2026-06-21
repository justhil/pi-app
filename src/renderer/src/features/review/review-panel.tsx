import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  FilePlus,
  FileEdit,
  FileMinus,
  Copy,
  Check,
  GitBranch,
  Loader2,
  FileDiff,
  FolderOpen,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

const SCOPES = ['turn', 'session', 'git'] as const
type Scope = (typeof SCOPES)[number]

function ChangeIcon({ type }: { type: string }) {
  if (type === 'added') return <FilePlus className="h-3.5 w-3.5 text-green-500" />
  if (type === 'deleted') return <FileMinus className="h-3.5 w-3.5 text-red-500" />
  return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
}

function parseGitStatus(status: string): { path: string; changeType: string }[] {
  if (!status) return []
  const out: { path: string; changeType: string }[] = []
  for (const line of status.trim().split('\n').filter(Boolean)) {
    if (line.startsWith('##')) continue
    if (line.length < 4) continue
    const code = line.substring(0, 2)
    const path = line.substring(3).trim()
    if (!path) continue
    let changeType = 'modified'
    if (code.includes('A') || code.includes('?')) changeType = 'added'
    else if (code.includes('D')) changeType = 'deleted'
    else if (code.includes('R')) changeType = 'renamed'
    out.push({ path, changeType })
  }
  return out
}

function splitDiffByFile(raw: string): { path: string; hunks: string }[] {
  if (!raw.trim()) return []
  return raw
    .split(/^diff --git /m)
    .filter(Boolean)
    .map((chunk) => {
      const firstLine = chunk.split('\n')[0] || ''
      const m = firstLine.match(/a\/(.+?)\s+b\//) || firstLine.match(/b\/(.+)$/)
      const path = m ? m[1].trim() : firstLine.slice(0, 80)
      return { path, hunks: `diff --git ${chunk.trim()}` }
    })
}

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
  const [expandedMetaPath, setExpandedMetaPath] = useState<string | null>(null)

  const turnRunId = running ? activeRunId : lastRunId

  useEffect(() => {
    const onScope = (e: Event) => {
      const s = (e as CustomEvent<Scope>).detail
      if (s && SCOPES.includes(s)) setScope(s)
    }
    window.addEventListener('pi-desktop:review-scope', onScope)
    return () => window.removeEventListener('pi-desktop:review-scope', onScope)
  }, [])

  const loadGit = () => {
    if (!workspace) return
    setLoading(true)
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

  const turnFiles = useMemo(
    () => fileChanges.filter((f) => turnRunId && f.runId === turnRunId),
    [fileChanges, turnRunId],
  )

  const files =
    scope === 'git' ? gitData?.files || [] : scope === 'turn' ? turnFiles : fileChanges

  const gitFileDiffs = useMemo(
    () => (scope === 'git' && gitData?.raw ? splitDiffByFile(gitData.raw) : []),
    [scope, gitData?.raw],
  )

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
        {scope === 'git' && (
          <button type="button" onClick={loadGit} className="chrome-icon-btn rounded p-1" title="刷新">
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </button>
        )}
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
            <span className="text-[11px] text-muted-foreground/40">{t('review.empty')}</span>
          </div>
        ) : scope === 'git' ? (
          <div className="py-1">
            {files.map((fc) => {
              const diffEntry = gitFileDiffs.find((d) => fc.path === d.path || fc.path.endsWith(d.path))
              const open = expandedGitPath === fc.path
              return (
                <div key={fc.path} className="border-b border-border/30">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedGitPath(open ? null : fc.path)}
                    onKeyDown={(e) => e.key === 'Enter' && setExpandedGitPath(open ? null : fc.path)}
                    className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)]"
                  >
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <ChangeIcon type={fc.changeType} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{fc.path}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void ipcClient.invoke('shell.showItemInFolder', { path: fc.path })
                      }}
                      className="opacity-0 group-hover:opacity-100 chrome-icon-btn rounded p-0.5"
                    >
                      <FolderOpen className="h-3 w-3" />
                    </button>
                  </div>
                  {open && diffEntry && (
                    <pre className="max-h-48 overflow-auto border-t border-border/30 bg-[var(--bg-2)] px-3 py-2 font-mono text-[10px] text-foreground-secondary">
                      {diffEntry.hunks.slice(0, 12000)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-1.5">
            {files.map((fc) => {
              const open = expandedMetaPath === fc.path
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
    </div>
  )
}
