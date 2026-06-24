import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  parseGitDiff,
  isLargeDiff,
  isGeneratedFile,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
} from '@shared/diff-model'
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
  Columns2,
  Rows2,
  ExternalLink,
  GitCommitHorizontal,
  CheckCheck,
} from 'lucide-react'

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
type DiffMode = 'inline' | 'split'

function ChangeIcon({ type }: { type: string }) {
  if (type === 'added') return <FilePlus className="h-3.5 w-3.5 text-green-500" />
  if (type === 'deleted') return <FileMinus className="h-3.5 w-3.5 text-red-500" />
  return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
}

function parseGitStatus(status: string): { path: string; changeType: string; staged: boolean }[] {
  if (!status) return []
  const out: { path: string; changeType: string; staged: boolean }[] = []
  for (const line of status.trim().split('\n').filter(Boolean)) {
    if (line.startsWith('##')) continue
    if (line.length < 4) continue
    const code = line.substring(0, 2)
    const path = line.substring(3).trim()
    if (!path) continue
    const x = code[0]
    const y = code[1]
    let changeType = 'modified'
    if (x === 'A' || x === '?' || y === '?') changeType = 'added'
    else if (x === 'D' || y === 'D') changeType = 'deleted'
    else if (x === 'R' || y === 'R') changeType = 'renamed'
    const staged = x !== ' ' && x !== '?'
    out.push({ path, changeType, staged })
  }
  return out
}

function lineColor(type: DiffLine['type']): string {
  if (type === 'added') return 'bg-green-500/8 text-green-700 dark:text-green-300'
  if (type === 'removed') return 'bg-red-500/8 text-red-700 dark:text-red-300'
  if (type === 'hunk-header') return 'text-foreground-secondary/60'
  return 'text-foreground-secondary'
}

function linePrefix(type: DiffLine['type']): string {
  if (type === 'added') return '+'
  if (type === 'removed') return '-'
  if (type === 'hunk-header') return '@'
  return ' '
}

function DiffHunkView({
  hunk,
  mode,
  staged,
  onToggleStage,
  filePath,
  cwd,
}: {
  hunk: DiffHunk
  mode: DiffMode
  staged: boolean
  onToggleStage: () => void
  filePath: string
  cwd: string
}) {
  return (
    <div className="border-b border-border/20 last:border-0">
      <div className="flex items-center gap-1.5 bg-[var(--bg-1)] px-2 py-1">
        <button
          type="button"
          onClick={onToggleStage}
          className={cn(
            'chrome-icon-btn rounded p-0.5 transition-colors',
            staged ? 'text-green-500' : 'text-muted-foreground/50 hover:text-foreground',
          )}
          title={staged ? '撤销暂存此 hunk' : '暂存此 hunk'}
        >
          <CheckCheck className="h-3 w-3" />
        </button>
        <span className="font-mono text-[10px] text-foreground-secondary/60">
          @@ -{hunk.oldStart},{hunk.oldEnd - hunk.oldStart + 1} +{hunk.newStart},{hunk.newEnd - hunk.newStart + 1} @@
        </span>
        <button
          type="button"
          onClick={() => void ipcClient.invoke('shell.openPath', { path: `${cwd}/${filePath}` })}
          className="ml-auto opacity-0 hover:opacity-100 chrome-icon-btn rounded p-0.5"
          title="在编辑器打开"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {mode === 'inline' ? (
        <div className="overflow-x-auto font-mono text-[10px] leading-[1.5]">
          {hunk.lines.map((l, i) => (
            <div key={i} className={cn('flex px-2 whitespace-pre', lineColor(l.type))}>
              <span className="w-3 shrink-0 select-none text-foreground-secondary/40">{linePrefix(l.type)}</span>
              <span className="min-w-0">{l.content}</span>
            </div>
          ))}
        </div>
      ) : (
        <SplitHunk hunk={hunk} />
      )}
    </div>
  )
}

function SplitHunk({ hunk }: { hunk: DiffHunk }) {
  const left: DiffLine[] = []
  const right: DiffLine[] = []
  for (const l of hunk.lines) {
    if (l.type === 'hunk-header') continue
    if (l.type === 'added') right.push(l)
    else if (l.type === 'removed') left.push(l)
    else {
      left.push(l)
      right.push(l)
    }
  }
  const maxRows = Math.max(left.length, right.length)
  return (
    <div className="grid grid-cols-2 overflow-x-auto font-mono text-[10px] leading-[1.5]">
      <div className="border-r border-border/30">
        {Array.from({ length: maxRows }).map((_, i) => {
          const l = left[i]
          if (!l) return <div key={i} className="px-2" />
          return (
            <div key={i} className={cn('flex px-2 whitespace-pre', lineColor(l.type))}>
              <span className="w-3 shrink-0 select-none text-foreground-secondary/40">{l.type === 'removed' ? '-' : ' '}</span>
              <span className="min-w-0">{l.content}</span>
            </div>
          )
        })}
      </div>
      <div>
        {Array.from({ length: maxRows }).map((_, i) => {
          const l = right[i]
          if (!l) return <div key={i} className="px-2" />
          return (
            <div key={i} className={cn('flex px-2 whitespace-pre', lineColor(l.type))}>
              <span className="w-3 shrink-0 select-none text-foreground-secondary/40">{l.type === 'added' ? '+' : ' '}</span>
              <span className="min-w-0">{l.content}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FileDiffView({
  file,
  fallbackPath,
  fallbackChangeType,
  staged: fileStaged,
  mode,
  cwd,
  defaultOpen,
}: {
  file: DiffFile | undefined
  fallbackPath: string
  fallbackChangeType: string
  staged: boolean
  mode: DiffMode
  cwd: string
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [stagedHunks, setStagedHunks] = useState<Set<number>>(
    () => (fileStaged && file ? new Set(file.hunks.map((_, i) => i)) : new Set()),
  )
  const filePath = file?.path ?? fallbackPath

  const toggleStage = useCallback(
    (hunkIdx: number, hunk: DiffHunk) => {
      const patch = hunk.patch || ''
      const isStaged = stagedHunks.has(hunkIdx)
      const next = new Set(stagedHunks)
      ipcClient
        .invoke(isStaged ? 'review.unstageHunks' : 'review.stageHunks', {
          cwd,
          files: [{ path: filePath, hunkPatches: [patch] }],
        })
        .then((res) => {
          if (res?.ok) {
            if (isStaged) next.delete(hunkIdx)
            else next.add(hunkIdx)
            setStagedHunks(next)
          }
        })
        .catch(() => {})
    },
    [stagedHunks, filePath, cwd],
  )

  return (
    <div className="border-b border-border/30">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
        className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)]"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <ChangeIcon type={file?.status ?? fallbackChangeType} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{filePath}</span>
        {file && (
          <>
            <span className="shrink-0 text-[9px] text-green-500/80">+{file.additions}</span>
            <span className="shrink-0 text-[9px] text-red-500/80">-{file.deletions}</span>
          </>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void ipcClient.invoke('shell.openPath', { path: `${cwd}/${filePath}` })
          }}
          className="opacity-0 group-hover:opacity-100 chrome-icon-btn rounded p-0.5"
          title="在编辑器打开"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void ipcClient.invoke('shell.showItemInFolder', { path: filePath })
          }}
          className="opacity-0 group-hover:opacity-100 chrome-icon-btn rounded p-0.5"
          title="在文件夹显示"
        >
          <FolderOpen className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <div className="border-t border-border/30 bg-[var(--bg-2)]">
          {file?.large && (
            <div className="px-3 py-1.5 text-[10px] text-amber-600/80">
              大变更（{file.additions + file.deletions} 行）
            </div>
          )}
          {file?.generated && (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60">生成文件</div>
          )}
          {!file && (
            <div className="px-3 py-3 text-[10px] text-muted-foreground/60">
              无可显示文本差异（二进制 / 纯重命名 / 模式变更）
            </div>
          )}
          {file?.hunks.map((hunk, hi) => (
            <DiffHunkView
              key={hi}
              hunk={hunk}
              mode={mode}
              staged={stagedHunks.has(hi)}
              onToggleStage={() => toggleStage(hi, hunk)}
              filePath={filePath}
              cwd={cwd}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CommitBar({ cwd, onCommitted }: { cwd: string; onCommitted: () => void }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hash, setHash] = useState<string | null>(null)

  const handleCommit = () => {
    if (!message.trim()) return
    setCommitting(true)
    setError(null)
    ipcClient
      .invoke('review.commit', { cwd, message })
      .then((res) => {
        if (res?.ok) {
          setHash(res.commitHash || null)
          setMessage('')
          setOpen(false)
          onCommitted()
        } else {
          setError(res?.error || '提交失败')
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setCommitting(false))
  }

  return (
    <div className="border-t border-border/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-foreground-secondary hover:bg-[var(--bg-hover)]"
      >
        <GitCommitHorizontal className="h-3.5 w-3.5" />
        提交暂存的变更
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-2">
          <textarea
            className="settings-field-focus w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px]"
            rows={3}
            placeholder="commit message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {error && <div className="text-[10px] text-destructive">{error}</div>}
          {hash && <div className="text-[10px] text-green-600">已提交 {hash.slice(0, 8)}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="settings-chip rounded-md border border-border px-2.5 py-1 text-[11px]"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="settings-chip rounded-md bg-primary px-2.5 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
              disabled={!message.trim() || committing}
              onClick={handleCommit}
            >
              {committing ? '提交中…' : '提交'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
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

  const turnFiles = useMemo(
    () => fileChanges.filter((f) => turnRunId && f.runId === turnRunId),
    [fileChanges, turnRunId],
  )

  const files: AnyFileEntry[] =
    scope === 'git' ? (gitData?.files as AnyFileEntry[]) || [] : scope === 'turn' ? turnFiles : fileChanges

  const diffFiles = useMemo<DiffFile[]>(() => {
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
            <span className="text-[11px] text-muted-foreground/40">{t('review.empty')}</span>
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
                  staged={fc.staged}
                  mode={diffMode}
                  cwd={cwd}
                  defaultOpen={expandedGitPath === fc.path}
                />
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
      {scope === 'git' && gitData?.isRepo !== false && files.length > 0 && (
        <CommitBar cwd={cwd} onCommitted={loadGit} />
      )}
    </div>
  )
}
