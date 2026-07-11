import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { openReviewSessionForPath, openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'
import type { TimelineDisplayItem } from './timeline-display-items'
import {
  buildTurnActivitySummary,
  collectRunIdsFromBlocks,
  type TurnFileStat,
} from './timeline-turn-activity'

function openReviewPanel(path?: string) {
  if (path) openReviewSessionForPath(path)
  else {
    const store = useUIStore.getState()
    store.setActivePanel('review')
    if (store.rightPanelCollapsed) store.toggleRightPanel()
    window.dispatchEvent(new CustomEvent('pi-desktop:review-scope', { detail: 'session' }))
  }
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums">
      {additions > 0 && (
        <span className="text-emerald-600/90 dark:text-emerald-400/85">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-rose-500/80 dark:text-rose-400/80">-{deletions}</span>
      )}
    </span>
  )
}

function FileChangeRow({ file }: { file: TurnFileStat }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
      onClick={() => openWorkspaceRelativePath(file.path)}
      onContextMenu={(event) => {
        event.preventDefault()
        openReviewPanel(file.path)
      }}
      title={t('timeline:activity.openFileHint', { path: file.path })}
    >
      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/45" />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/85 group-hover:text-foreground">
        {file.displayName}
      </span>
      <DiffStat additions={file.additions} deletions={file.deletions} />
    </button>
  )
}

/**
 * End-of-turn files card only.
 * Hidden while the turn is still live (agent running / streaming / waiting UI).
 */
export const TurnActivityBlock = memo(function TurnActivityBlock({
  blocks,
  isStreaming,
}: {
  blocks: TimelineDisplayItem[]
  /** True while the whole turn is still in progress — hide file list until done. */
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)

  const summary = useMemo(() => {
    const runIds = collectRunIdsFromBlocks(blocks)
    return buildTurnActivitySummary(blocks, fileChanges, {
      runIds,
      workspaceRoot: workspace,
    })
  }, [blocks, fileChanges, workspace])

  // Wait until the full agent turn finishes — not just assistant stream end.
  if (isStreaming) return null
  if (summary.files.length === 0) return null

  return (
    <div className="mb-2.5 mt-1">
      <div className="overflow-hidden rounded-md border border-border/40">
        <div className="flex items-center justify-between gap-2 border-b border-border/30 px-2.5 py-1.5">
          <span className="text-[11px] font-medium tabular-nums text-foreground-secondary">
            {t('timeline:activity.filesChanged', { count: summary.files.length })}
          </span>
          <button
            type="button"
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] text-foreground-secondary/80',
              'hover:bg-[var(--bg-hover)] hover:text-foreground',
            )}
            onClick={() => openReviewPanel(summary.files[0]?.path)}
          >
            {t('timeline:activity.review')}
          </button>
        </div>
        <div className="max-h-40 overflow-y-auto py-0.5">
          {summary.files.map((file) => (
            <FileChangeRow key={file.path} file={file} />
          ))}
        </div>
      </div>
    </div>
  )
})
