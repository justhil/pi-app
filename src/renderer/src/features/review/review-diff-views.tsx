import { useState, useCallback } from 'react'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { DiffFile, DiffHunk, DiffLine } from '@shared/diff-model'
import { buildSplitDiffRows } from '@shared/diff-split'
import { ReviewHunkComments } from './review-hunk-comments'
import { LineGutterAddButton } from '@renderer/components/ui/line-gutter-add'
import {
  FilePlus,
  FileEdit,
  FileMinus,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  CheckCheck,
  GitCommitHorizontal,
} from 'lucide-react'

export type DiffMode = 'inline' | 'split'

export function ChangeIcon({ type }: { type: string }) {
  if (type === 'added') return <FilePlus className="h-3.5 w-3.5 text-green-500" />
  if (type === 'deleted') return <FileMinus className="h-3.5 w-3.5 text-red-500" />
  return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
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
  hunkIndex,
  mode,
  staged,
  onToggleStage,
  filePath,
  cwd,
}: {
  hunk: DiffHunk
  hunkIndex: number
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
        <ReviewHunkComments cwd={cwd} filePath={filePath} hunkIndex={hunkIndex} />
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
          {hunk.lines.map((l, i) => {
            const lineNo =
              l.type === 'removed'
                ? l.oldLineNumber
                : l.type === 'added' || l.type === 'context'
                  ? l.newLineNumber ?? l.oldLineNumber
                  : undefined
            const canRef = !!lineNo && l.type !== 'hunk-header'
            return (
              <div
                key={i}
                className={cn('group/line flex items-stretch px-1 whitespace-pre', lineColor(l.type))}
              >
                <span className="flex w-10 shrink-0 select-none items-center justify-end gap-0.5 pr-1 text-foreground-secondary/40">
                  {canRef ? (
                    <LineGutterAddButton
                      path={filePath}
                      line={lineNo!}
                      content={l.content}
                      className="mr-0.5"
                    />
                  ) : (
                    <span className="w-[1.15em]" />
                  )}
                  <span className="w-6 text-right tabular-nums">
                    {lineNo ?? linePrefix(l.type)}
                  </span>
                </span>
                <span className="w-3 shrink-0 select-none text-foreground-secondary/40">
                  {linePrefix(l.type)}
                </span>
                <span className="min-w-0 flex-1">{l.content}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <SplitHunk hunk={hunk} filePath={filePath} />
      )}
    </div>
  )
}

function SplitHunk({ hunk, filePath }: { hunk: DiffHunk; filePath: string }) {
  const pseudoFile: DiffFile = {
    path: filePath,
    status: 'modified',
    changeType: 'modified',
    additions: 0,
    deletions: 0,
    hunks: [hunk],
    binary: false,
    large: false,
    generated: false,
  }
  const rows = buildSplitDiffRows(pseudoFile).slice(1)
  return (
    <div className="grid grid-cols-2 overflow-x-auto font-mono text-[10px] leading-[1.5]">
      <div className="border-r border-border/30">
        {rows.map((row, i) => {
          const lineNo = row.left.oldLine ?? row.left.newLine
          const canRef = !!lineNo && row.left.kind !== 'empty'
          return (
            <div
              key={i}
              className={cn(
                'group/line flex items-stretch px-1 whitespace-pre',
                row.left.kind === 'remove' && 'bg-red-500/8 text-red-700 dark:text-red-300',
                row.left.kind === 'context' && 'text-foreground-secondary',
              )}
            >
              <span className="flex w-10 shrink-0 select-none items-center justify-end gap-0.5 pr-1 text-foreground-secondary/40">
                {canRef ? (
                  <LineGutterAddButton path={filePath} line={lineNo!} content={row.left.text} />
                ) : (
                  <span className="w-[1.15em]" />
                )}
                <span className="w-6 text-right tabular-nums">{lineNo ?? ''}</span>
              </span>
              <span className="w-3 shrink-0 select-none text-foreground-secondary/40">
                {row.left.kind === 'remove' ? '-' : ' '}
              </span>
              <span className="min-w-0 flex-1">{row.left.text}</span>
            </div>
          )
        })}
      </div>
      <div>
        {rows.map((row, i) => {
          const lineNo = row.right.newLine ?? row.right.oldLine
          const canRef = !!lineNo && row.right.kind !== 'empty'
          return (
            <div
              key={i}
              className={cn(
                'group/line flex items-stretch px-1 whitespace-pre',
                row.right.kind === 'add' && 'bg-green-500/8 text-green-700 dark:text-green-300',
                row.right.kind === 'context' && 'text-foreground-secondary',
              )}
            >
              <span className="flex w-10 shrink-0 select-none items-center justify-end gap-0.5 pr-1 text-foreground-secondary/40">
                {canRef ? (
                  <LineGutterAddButton path={filePath} line={lineNo!} content={row.right.text} />
                ) : (
                  <span className="w-[1.15em]" />
                )}
                <span className="w-6 text-right tabular-nums">{lineNo ?? ''}</span>
              </span>
              <span className="w-3 shrink-0 select-none text-foreground-secondary/40">
                {row.right.kind === 'add' ? '+' : ' '}
              </span>
              <span className="min-w-0 flex-1">{row.right.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function FileDiffView({
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
          {file?.generated && <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60">生成文件</div>}
          {!file && (
            <div className="px-3 py-3 text-[10px] text-muted-foreground/60">
              无可显示文本差异（二进制 / 纯重命名 / 模式变更）
            </div>
          )}
          {file?.hunks.map((hunk, hi) => (
            <DiffHunkView
              key={hi}
              hunk={hunk}
              hunkIndex={hi}
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

export function ReviewCommitBar({ cwd, onCommitted }: { cwd: string; onCommitted: () => void }) {
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