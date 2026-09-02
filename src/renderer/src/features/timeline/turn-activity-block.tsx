import { memo, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  FileCode2,
  GitBranch,
} from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  openReviewGitForPath,
  openWorkspaceRelativePath,
  requestReviewPanel,
} from '@renderer/lib/open-workspace-path'
import { parseUnifiedDiffFromText } from '@extension-compat/renderer/native-diff'
import {
  contextMenuItemClass,
  contextMenuPanelClass,
  useDismissContextMenu,
} from '@renderer/features/workspace/context-menu-shared'
import { useTurnDiffStore, findTurnDiffRecord } from '@renderer/stores/turn-diff-store'
import type { TimelineDisplayItem } from './timeline-display-items'
import {
  applyTurnDiffToSummary,
  buildTurnActivitySummary,
  collectRunIdsFromBlocks,
  collectTurnIdsFromBlocks,
  type TurnFileStat,
} from './timeline-turn-activity'
import { DiffStatBadge } from './diff-stat-badge'
import { DiffBody } from './tool-previews'

/** Show this many files before "Show N more" (Cursor-style). */
const FILES_PREVIEW_LIMIT = 6

function FileTypeGlyph({ path }: { path: string }) {
  const base = path.split(/[/\\]/).pop() || path
  const dot = base.lastIndexOf('.')
  const label = dot > 0 ? base.slice(dot + 1).toUpperCase().slice(0, 3) : ''
  if (!label) {
    return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-600/80 dark:text-sky-400/80" />
  }
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-[1.125rem] shrink-0 items-center justify-center rounded-[3px]',
        'bg-sky-500/12 px-0.5 font-mono text-[9px] leading-none tracking-tight',
        'text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
      )}
      aria-hidden
    >
      {label}
    </span>
  )
}

function skipReasonText(
  reason: TurnFileStat['skipReason'],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  switch (reason) {
    case 'oversize':
      return t('timeline:activity.skipOversize')
    case 'binary':
      return t('timeline:activity.skipBinary')
    case 'outside_workspace':
      return t('timeline:activity.skipOutsideWorkspace')
    case 'unreadable':
      return t('timeline:activity.skipUnreadable')
    case 'budget':
      return t('timeline:activity.skipBudget')
    default:
      return ''
  }
}

type RowMenu = { x: number; y: number; file: TurnFileStat }

function FileChangeRow({ file }: { file: TurnFileStat }) {
  const { t } = useTranslation()
  const workspace = useUIStore((s) => s.currentWorkspace)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState<RowMenu | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismissContextMenu(!!menu, menuRef, () => setMenu(null))

  const shortName = file.displayName.split(/[/\\]/).pop() || file.displayName
  const isRelative = !!workspace && file.displayName.replace(/\\/g, '/') !== file.path.replace(/\\/g, '/')
  const deleted = file.diffStatus === 'deleted' || file.changeType === 'deleted'
  const opDiffs = file.opDiffs ?? []
  // 有可展开内容（净 diff / 逐操作 diff）→ 行点击展开；否则行点击直接打开文件
  const expandable = !!file.diffText || opDiffs.length > 0

  const diffRows = useMemo(
    () => (file.diffText ? parseUnifiedDiffFromText(file.diffText) : null),
    [file.diffText],
  )

  const copyAbsolute = () => {
    navigator.clipboard
      .writeText(file.path)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        import('sonner').then(({ toast }) => toast.error(t('timeline:activity.copyFailed')))
      })
  }

  const copyRelative = () => {
    navigator.clipboard
      .writeText(file.displayName)
      .then(() => setMenu(null))
      .catch(() => {
        import('sonner').then(({ toast }) => toast.error(t('timeline:activity.copyFailed')))
      })
  }

  const revealInFolder = () => {
    setMenu(null)
    void ipcClient.invoke('shell.showItemInFolder', { path: file.path })
  }

  const openGitReview = () => {
    setMenu(null)
    openReviewGitForPath(file.path)
  }

  return (
    <div
      className="group relative"
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY, file })
      }}
    >
      <div className="flex w-full items-center gap-0.5 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--bg-hover)]">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            if (expandable) setExpanded((v) => !v)
            else openWorkspaceRelativePath(file.path)
          }}
          title={expandable ? t('timeline:activity.openFileHint', { path: file.path }) : t('timeline:activity.openFile')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-1 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 timeline-text-placeholder" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 timeline-text-placeholder" />
          )}
          <FileTypeGlyph path={file.path} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] leading-snug timeline-text-secondary group-hover:text-[var(--text-primary)]">
            {isRelative ? (
              <>
                <span className="text-[10.5px] timeline-text-quiet">
                  {file.displayName.split(/[/\\]/).slice(0, -1).join('/')}
                  {file.displayName.includes('/') || file.displayName.includes('\\') ? '/' : ''}
                </span>
                {shortName}
              </>
            ) : (
              shortName
            )}
          </span>
          <DiffStatBadge additions={file.additions} deletions={file.deletions} />
        </button>
        <button
          type="button"
          disabled={deleted}
          title={deleted ? t('timeline:activity.fileDeleted') : t('timeline:activity.openFile')}
          onClick={() => openWorkspaceRelativePath(file.path)}
          className="chrome-icon-btn hidden h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 disabled:cursor-default disabled:opacity-30 sm:flex"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          title={t('timeline:activity.copyPath')}
          onClick={copyAbsolute}
          className="chrome-icon-btn hidden h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 sm:flex"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        </button>
        <button
          type="button"
          title={t('timeline:activity.reviewInGit')}
          onClick={openGitReview}
          className="chrome-icon-btn hidden h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 sm:flex"
        >
          <GitBranch className="h-3 w-3" />
        </button>
      </div>

      {expanded ? (
        <div className="ml-6 rounded-md border border-border/40 bg-[var(--bg-2)]/40">
          {diffRows && diffRows.length > 0 ? (
            <>
              {file.diffTruncated && (
                <div className="border-b border-border/30 px-2.5 py-1 text-[10px] text-amber-600/90">
                  {t('timeline:activity.diffTruncated')}
                </div>
              )}
              <DiffBody rows={diffRows} />
            </>
          ) : opDiffs.length > 0 ? (
            <div>
              <div className="border-b border-border/30 px-2.5 py-1 text-[10px] timeline-text-quiet">
                {t('timeline:activity.opDiffNote')}
              </div>
              {opDiffs.map((op, index) => (
                <div key={index} className="border-b border-border/20 last:border-0">
                  <div className="px-2.5 py-0.5 text-[10px] font-medium timeline-text-secondary">
                    {op.label}
                  </div>
                  <DiffBody rows={op.rows} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 px-2.5 py-2">
              <span className="text-[11px] text-foreground-secondary">
                {file.skipReason
                  ? skipReasonText(file.skipReason, t)
                  : file.diffBinary
                    ? t('timeline:activity.binaryDiff')
                    : t('timeline:activity.noDiff')}
              </span>
              <span className="flex items-center gap-3 text-[10.5px] timeline-text-quiet">
                <button
                  type="button"
                  onClick={() => openWorkspaceRelativePath(file.path)}
                  disabled={deleted}
                  className="hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  {t('timeline:activity.openFile')}
                </button>
                <button type="button" onClick={openGitReview} className="hover:text-[var(--text-primary)]">
                  {t('timeline:activity.reviewInGit')}
                </button>
                <button type="button" onClick={copyAbsolute} className="hover:text-[var(--text-primary)]">
                  {t('timeline:activity.copyPath')}
                </button>
              </span>
            </div>
          )}
        </div>
      ) : null}

      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className={contextMenuPanelClass}
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button type="button" className={contextMenuItemClass} onClick={copyAbsolute}>
                {t('timeline:activity.copyPath')}
              </button>
              <button
                type="button"
                className={cn(contextMenuItemClass, !isRelative && 'pointer-events-none opacity-40')}
                disabled={!isRelative}
                onClick={copyRelative}
              >
                {t('timeline:activity.copyRelativePath')}
              </button>
              <button type="button" className={contextMenuItemClass} onClick={revealInFolder}>
                {t('timeline:activity.revealInFolder')}
              </button>
              <button type="button" className={contextMenuItemClass} onClick={openGitReview}>
                {t('timeline:activity.reviewInGit')}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/**
 * Cursor-style "N Files Changed" card — 每个已完成回合保留一份。
 * 单击文件行展开该回合的最终净 diff（Worker 结算）；无 diff 数据时给出原因与操作入口。
 */
export const TurnActivityBlock = memo(function TurnActivityBlock({
  blocks,
  turnOrdinal,
  isLastCompletedTurn,
}: {
  blocks: TimelineDisplayItem[]
  /** 视图内回合序号（0 起）：与 worker 的 turnOrdinal（1 起）对应做降级匹配 */
  turnOrdinal: number
  /** 视图最后一个已完成回合：允许“最新记录”兜底匹配 */
  isLastCompletedTurn: boolean
}) {
  const { t } = useTranslation()
  const [showAllFiles, setShowAllFiles] = useState(false)
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const historySessionFile = useUIStore((s) => s.historySessionFile)
  const diffRecords = useTurnDiffStore((s) => s.records)

  const summary = useMemo(() => {
    const base = buildTurnActivitySummary(blocks, fileChanges, {
      runIds: collectRunIdsFromBlocks(blocks),
      workspaceRoot: workspace,
    })
    const record = findTurnDiffRecord(
      historySessionFile,
      collectTurnIdsFromBlocks(blocks),
      [...collectRunIdsFromBlocks(blocks)],
      { turnOrdinal: turnOrdinal + 1, fallbackNewest: isLastCompletedTurn },
    )
    return applyTurnDiffToSummary(base, record?.files, workspace)
    // diffRecords 变化时重算（回合结算事件到达后刷新卡片）
  }, [blocks, fileChanges, workspace, historySessionFile, diffRecords, turnOrdinal, isLastCompletedTurn])

  if (summary.files.length === 0) return null

  const totalFiles = summary.files.length
  const hasOverflow = totalFiles > FILES_PREVIEW_LIMIT
  const visibleFiles =
    showAllFiles || !hasOverflow ? summary.files : summary.files.slice(0, FILES_PREVIEW_LIMIT)
  const hiddenCount = totalFiles - FILES_PREVIEW_LIMIT

  return (
    <div
      className={cn(
        'timeline-files-changed-card mt-1.5 mb-0.5 overflow-hidden rounded-xl',
        'border border-border/60 bg-[var(--bg-1)]/80',
        'shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-3 pt-2.5 pb-1">
        <span className="text-[12px] font-medium tracking-tight timeline-text-secondary">
          {t('timeline:activity.filesChangedTitle', { count: totalFiles })}
        </span>
        <button
          type="button"
          className={cn(
            'shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium',
            'timeline-text-quiet hover:bg-[var(--bg-hover)] hover:opacity-100',
          )}
          onClick={() => requestReviewPanel()}
        >
          {t('timeline:activity.review')}
        </button>
      </div>

      <div className="px-1.5 pb-1.5">
        {visibleFiles.map((file) => (
          <FileChangeRow key={file.path} file={file} />
        ))}
        {hasOverflow && !showAllFiles ? (
          <button
            type="button"
            className={cn(
              'mt-0.5 flex w-full items-center gap-1 rounded-md px-1.5 py-1',
              'text-left text-[12px] timeline-text-quiet',
              'hover:bg-[var(--bg-hover)]',
            )}
            onClick={() => setShowAllFiles(true)}
          >
            <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
            {t('timeline:activity.showMoreFiles', { count: hiddenCount })}
          </button>
        ) : null}
        {hasOverflow && showAllFiles ? (
          <button
            type="button"
            className={cn(
              'mt-0.5 flex w-full items-center gap-1 rounded-md px-1.5 py-1',
              'text-left text-[12px] timeline-text-quiet',
              'hover:bg-[var(--bg-hover)]',
            )}
            onClick={() => setShowAllFiles(false)}
          >
            {t('timeline:activity.showFewerFiles')}
          </button>
        ) : null}
      </div>
    </div>
  )
})
