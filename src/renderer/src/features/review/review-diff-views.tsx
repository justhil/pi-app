import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  ChevronRight,
  ExternalLink,
  FolderOpen,
  CheckCheck,
} from '@renderer/components/icons'

export type DiffMode = 'inline' | 'split'

export function ChangeIcon({ type }: { type: string }) {
  if (type === 'added') return <FilePlus className="h-3.5 w-3.5 text-[var(--diff-added)]" />
  if (type === 'deleted') return <FileMinus className="h-3.5 w-3.5 text-[var(--diff-removed)]" />
  return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
}

function lineColor(type: DiffLine['type']): string {
  if (type === 'added') return 'diff-line-added'
  if (type === 'removed') return 'diff-line-removed'
  if (type === 'hunk-header') return 'text-foreground-secondary/60'
  return 'text-foreground-secondary'
}

function linePrefix(type: DiffLine['type']): string {
  if (type === 'added') return '+'
  if (type === 'removed') return '-'
  if (type === 'hunk-header') return '@'
  return ' '
}

/** "src/app/foo.ts" → { name: "foo.ts", dir: "src/app" } for a name-first row layout. */
export function splitReviewPath(path: string): { name: string; dir: string } {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? { name: normalized, dir: '' } : { name: normalized.slice(index + 1), dir: normalized.slice(0, index) }
}

function DiffCodeLine({
  lineNo,
  gutter,
  prefix,
  text,
  className,
  filePath,
  canRef,
}: {
  lineNo?: number
  gutter: string
  prefix: string
  text: string
  className?: string
  filePath: string
  canRef: boolean
}) {
  return (
    <div className={cn('group/line flex min-w-0 items-start px-1', className)}>
      <span className="flex w-10 shrink-0 select-none items-start justify-end gap-0.5 pt-px pr-1 text-foreground-secondary/40">
        {canRef && lineNo != null ? (
          <LineGutterAddButton path={filePath} line={lineNo} content={text} className="mr-0.5" />
        ) : (
          <span className="w-[1.15em]" />
        )}
        <span className="w-6 text-right tabular-nums">{gutter}</span>
      </span>
      <span className="w-3 shrink-0 select-none text-foreground-secondary/40">{prefix}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{text}</span>
    </div>
  )
}

function openInEditor(cwd: string, filePath: string): void {
  void ipcClient.invoke('shell.openPath', { path: `${cwd}/${filePath}` })
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
  const { t } = useTranslation()
  return (
    <div className="review-hunk border-b border-border/20 last:border-0">
      <div className="group/hunk flex items-center gap-1.5 bg-[var(--bg-1)] px-2 py-1">
        <button
          type="button"
          onClick={onToggleStage}
          className={cn(
            'chrome-icon-btn rounded p-0.5 transition-colors',
            staged ? 'text-[var(--diff-added)]' : 'text-muted-foreground/50 hover:text-foreground',
          )}
          title={staged ? t('review:unstageHunk') : t('review:stageHunk')}
          aria-label={staged ? t('review:unstageHunk') : t('review:stageHunk')}
        >
          <CheckCheck className="h-3 w-3" />
        </button>
        <span className="font-mono text-[10px] text-foreground-secondary/60">
          @@ -{hunk.oldStart},{hunk.oldEnd - hunk.oldStart + 1} +{hunk.newStart},{hunk.newEnd - hunk.newStart + 1} @@
        </span>
        <ReviewHunkComments cwd={cwd} filePath={filePath} hunkIndex={hunkIndex} />
        <button
          type="button"
          onClick={() => openInEditor(cwd, filePath)}
          className="chrome-icon-btn ml-auto rounded p-0.5 opacity-0 transition-opacity group-hover/hunk:opacity-100 focus-visible:opacity-100"
          title={t('review:openInEditor')}
          aria-label={t('review:openInEditor')}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {mode === 'inline' ? (
        <div className="min-w-0 font-mono text-[12px] leading-[1.65]">
          {hunk.lines.map((l, i) => {
            const lineNo =
              l.type === 'removed'
                ? l.oldLineNumber
                : l.type === 'added' || l.type === 'context'
                  ? l.newLineNumber ?? l.oldLineNumber
                  : undefined
            const prefix = linePrefix(l.type)
            return (
              <DiffCodeLine
                key={i}
                lineNo={lineNo}
                gutter={lineNo != null ? String(lineNo) : prefix}
                prefix={prefix}
                text={l.content}
                className={lineColor(l.type)}
                filePath={filePath}
                canRef={!!lineNo && l.type !== 'hunk-header'}
              />
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
    <div className="grid min-w-0 grid-cols-2 font-mono text-[12px] leading-[1.65]">
      {rows.map((row, i) => {
        const leftNo = row.left.oldLine ?? row.left.newLine
        const rightNo = row.right.newLine ?? row.right.oldLine
        return (
          <div key={i} className="contents">
            <DiffCodeLine
              lineNo={leftNo}
              gutter={leftNo != null ? String(leftNo) : ''}
              prefix={row.left.kind === 'remove' ? '-' : ' '}
              text={row.left.text}
              className={cn(
                'min-w-0 border-r border-border/30',
                row.left.kind === 'remove' && 'diff-line-removed',
                row.left.kind === 'context' && 'text-foreground-secondary',
              )}
              filePath={filePath}
              canRef={!!leftNo && row.left.kind !== 'empty'}
            />
            <DiffCodeLine
              lineNo={rightNo}
              gutter={rightNo != null ? String(rightNo) : ''}
              prefix={row.right.kind === 'add' ? '+' : ' '}
              text={row.right.text}
              className={cn(
                'min-w-0',
                row.right.kind === 'add' && 'diff-line-added',
                row.right.kind === 'context' && 'text-foreground-secondary',
              )}
              filePath={filePath}
              canRef={!!rightNo && row.right.kind !== 'empty'}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Proportional +/- bar (five cells), like a PR file list. */
function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions
  if (total === 0) return null
  const added = Math.round((additions / total) * 5)
  return (
    <span className="review-change-bar" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} data-kind={i < added ? 'add' : 'del'} />
      ))}
    </span>
  )
}

export const FileDiffView = memo(function FileDiffView({
  file,
  fallbackPath,
  fallbackChangeType,
  group,
  mode,
  cwd,
  defaultOpen,
  bulk,
  onMutated,
}: {
  file: DiffFile | undefined
  fallbackPath: string
  fallbackChangeType: string
  group: 'staged' | 'unstaged'
  mode: DiffMode
  cwd: string
  defaultOpen: boolean
  /** Expand-all / collapse-all from the toolbar; a new object re-applies it. */
  bulk: { open: boolean } | null
  onMutated: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const filePath = file?.path ?? fallbackPath
  const staged = group === 'staged'
  const { name, dir } = splitReviewPath(filePath)

  useEffect(() => {
    if (bulk) setOpen(bulk.open)
  }, [bulk])
  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  const toggleStage = useCallback(
    (hunk: DiffHunk) => {
      const patch = hunk.patch || ''
      if (!patch) return
      ipcClient
        .invoke(staged ? 'review.unstageHunks' : 'review.stageHunks', {
          cwd,
          files: [{ path: filePath, hunkPatches: [patch] }],
        })
        .then((res) => {
          if (res?.ok) onMutated()
        })
        .catch(() => {})
    },
    [staged, filePath, cwd, onMutated],
  )

  return (
    <div className="review-file min-w-0" data-open={open || undefined}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          setOpen((o) => !o)
        }}
        className="review-file-row group relative flex min-h-9 w-full cursor-pointer items-center gap-2 px-3 py-1.5"
        title={filePath}
      >
        <ChevronRight className="review-file-chevron h-3 w-3 shrink-0 text-foreground-secondary/70" />
        <ChangeIcon type={file?.status ?? fallbackChangeType} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="min-w-0 shrink truncate text-[12.5px] font-medium text-foreground">{name}</span>
          {dir ? <span className="review-file-dir min-w-0 flex-[1_1_0] truncate text-[11px] text-foreground-secondary/70">{dir}</span> : null}
        </span>
        {file ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
            {file.additions > 0 ? <span className="text-[var(--diff-added)]">+{file.additions}</span> : null}
            {file.deletions > 0 ? <span className="text-[var(--diff-removed)]">−{file.deletions}</span> : null}
            <ChangeBar additions={file.additions} deletions={file.deletions} />
          </span>
        ) : null}
        <span className="review-file-actions flex shrink-0 items-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openInEditor(cwd, filePath)
            }}
            className="chrome-icon-btn rounded p-0.5"
            title={t('review:openInEditor')}
            aria-label={t('review:openInEditor')}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void ipcClient.invoke('shell.showItemInFolder', { path: filePath })
            }}
            className="chrome-icon-btn rounded p-0.5"
            title={t('review:revealInFolder')}
            aria-label={t('review:revealInFolder')}
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        </span>
      </div>
      {open && (
        <div className="review-file-body min-w-0 overflow-hidden border-y border-border/30 bg-[var(--bg-2)]">
          {file?.large && (
            <div className="px-3 py-1.5 text-[10.5px] text-amber-600/80">
              {t('review:largeChange', { count: file.additions + file.deletions })}
            </div>
          )}
          {file?.generated && <div className="px-3 py-1.5 text-[10.5px] text-muted-foreground/60">{t('review:generatedFile')}</div>}
          {(!file || file.hunks.length === 0) && (
            <div className="px-3 py-3 text-[11px] text-muted-foreground/70">
              {file?.binary
                ? t('review:binaryFile')
                : file?.status === 'renamed'
                  ? t('review:renamedFrom', { path: file.oldPath || fallbackPath })
                  : t('review:noTextDiff')}
            </div>
          )}
          {file?.hunks.map((hunk, hi) => (
            <DiffHunkView
              key={hi}
              hunk={hunk}
              hunkIndex={hi}
              mode={mode}
              staged={staged}
              onToggleStage={() => toggleStage(hunk)}
              filePath={filePath}
              cwd={cwd}
            />
          ))}
        </div>
      )}
    </div>
  )
})
