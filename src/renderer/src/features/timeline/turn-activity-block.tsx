import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FileCode2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { openReviewSessionForPath, openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'
import type { TimelineDisplayItem } from './timeline-display-items'
import {
  buildTurnActivitySummary,
  collectRunIdsFromBlocks,
  type TurnFileStat,
} from './timeline-turn-activity'
import { DiffStatBadge } from './diff-stat-badge'

/** Show this many files before "Show N more" (Cursor-style). */
const FILES_PREVIEW_LIMIT = 6

function openReviewPanel(path?: string) {
  if (path) openReviewSessionForPath(path)
  else {
    const store = useUIStore.getState()
    store.setActivePanel('review')
    if (store.rightPanelCollapsed) store.toggleRightPanel()
    window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'session' }))
  }
}

function fileExtensionLabel(path: string): string {
  const base = path.split(/[/\\]/).pop() || path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toUpperCase().slice(0, 3)
}

function FileTypeGlyph({ path }: { path: string }) {
  const label = fileExtensionLabel(path)
  if (!label) {
    return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-600/80 dark:text-sky-400/80" />
  }
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-[1.125rem] shrink-0 items-center justify-center rounded-[3px]',
        'bg-sky-500/12 px-0.5 font-mono text-[9px] font-semibold leading-none tracking-tight',
        'text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
      )}
      aria-hidden
    >
      {label}
    </span>
  )
}

function FileChangeRow({ file }: { file: TurnFileStat }) {
  const { t } = useTranslation()
  const shortName = file.displayName.split(/[/\\]/).pop() || file.displayName
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
      onClick={() => openWorkspaceRelativePath(file.path)}
      onContextMenu={(event) => {
        event.preventDefault()
        openReviewPanel(file.path)
      }}
      title={t('timeline:activity.openFileHint', { path: file.path })}
    >
      <FileTypeGlyph path={file.path} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] leading-snug timeline-text-secondary group-hover:text-[var(--text-primary)]">
        {shortName}
      </span>
      <DiffStatBadge additions={file.additions} deletions={file.deletions} />
    </button>
  )
}

/**
 * Cursor-style "N Files Changed" card.
 * Parent mounts this only for the last completed turn (not mid-stream, not older turns).
 */
export const TurnActivityBlock = memo(function TurnActivityBlock({
  blocks,
}: {
  blocks: TimelineDisplayItem[]
}) {
  const { t } = useTranslation()
  const [showAllFiles, setShowAllFiles] = useState(false)
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)

  const summary = useMemo(() => {
    const runIds = collectRunIdsFromBlocks(blocks)
    return buildTurnActivitySummary(blocks, fileChanges, {
      runIds,
      workspaceRoot: workspace,
    })
  }, [blocks, fileChanges, workspace])

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
          onClick={() => openReviewPanel(summary.files[0]?.path)}
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
