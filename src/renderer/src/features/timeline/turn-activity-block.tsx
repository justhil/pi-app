import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, GitBranch } from 'lucide-react'
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
      {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
      {deletions > 0 && <span className="text-rose-500/90 dark:text-rose-400/90">-{deletions}</span>}
    </span>
  )
}

function FileChangeRow({ file }: { file: TurnFileStat }) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
      onClick={() => openWorkspaceRelativePath(file.path)}
      onContextMenu={(event) => {
        event.preventDefault()
        openReviewPanel(file.path)
      }}
      title={`${file.path}\n点击：Files 面板 · 右键：Review`}
    >
      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/55" />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/90 group-hover:text-foreground">
        {file.displayName}
      </span>
      <DiffStat additions={file.additions} deletions={file.deletions} />
    </button>
  )
}

/**
 * End-of-turn files card only (activity line lives on collapsed tool-group header).
 * Links into right-panel Review / Files.
 */
export const TurnActivityBlock = memo(function TurnActivityBlock({
  blocks,
  isStreaming,
}: {
  blocks: TimelineDisplayItem[]
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

  if (isStreaming) return null
  if (summary.files.length === 0) return null

  return (
    <div className="mb-3 mt-1.5">
      <div className="overflow-hidden rounded-xl border border-border/50 bg-[var(--bg-1)]/80">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            <GitBranch className="h-3.5 w-3.5 text-foreground-secondary/70" />
            {t('timeline:activity.filesChanged', { count: summary.files.length })}
          </div>
          <button
            type="button"
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium text-foreground-secondary',
              'hover:bg-[var(--bg-hover)] hover:text-foreground',
            )}
            onClick={() => openReviewPanel(summary.files[0]?.path)}
          >
            {t('timeline:activity.review')}
          </button>
        </div>
        <div className="max-h-48 overflow-y-auto py-1">
          {summary.files.map((file) => (
            <FileChangeRow key={file.path} file={file} />
          ))}
        </div>
      </div>
    </div>
  )
})
