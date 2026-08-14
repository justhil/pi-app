import type { FileChange, ToolTimelineItem } from '@renderer/stores/ui-store-types'
import type { TimelineDisplayItem } from './timeline-display-items'
import {
  resolveEditWriteDiffRows,
  type DiffRow,
} from '@extension-compat/renderer/native-diff'
import { fullPathFromArgs, normalizeToolArgs } from '@extension-compat/renderer/tool-output'
import type { TurnDiffFile } from '@shared/app-events'

export type TurnFileOpDiff = { label: string; rows: DiffRow[] }

export type TurnFileStat = {
  path: string
  /** repo-relative display path */
  displayName: string
  changeType: string
  additions: number
  deletions: number
  runId?: string
  source: 'file-event' | 'tool' | 'turn-diff'
  /** 回合最终净 diff（Worker 结算） */
  diffText?: string
  diffTruncated?: boolean
  diffBinary?: boolean
  diffStatus?: TurnDiffFile['status']
  skipReason?: TurnDiffFile['skipReason']
  sizeBefore?: number
  sizeAfter?: number
  /** 无净 diff 时的回退：本回合工具记录中的逐操作 diff（磁盘 JSONL 自带） */
  opDiffs?: TurnFileOpDiff[]
}

export type TurnActivitySummary = {
  toolNames: string[]
  toolCount: number
  searchCount: number
  commandCount: number
  exploreCount: number
  files: TurnFileStat[]
  additions: number
  deletions: number
}

const SEARCH_TOOLS = new Set(['grep', 'ffgrep', 'find', 'fffind'])
const COMMAND_TOOLS = new Set(['bash'])
const EXPLORE_TOOLS = new Set(['read', 'ls'])
const MUTATE_TOOLS = new Set(['write', 'edit', 'insert'])

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function toDisplayPath(path: string, workspaceRoot?: string | null): string {
  const normalized = path.replace(/\\/g, '/')
  if (!workspaceRoot) return normalized
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    return normalized.slice(root.length + 1)
  }
  return normalized
}

function collectToolsFromBlocks(blocks: TimelineDisplayItem[]): ToolTimelineItem[] {
  const tools: ToolTimelineItem[] = []
  for (const block of blocks) {
    if (block.kind === 'tool-group') {
      for (const tool of block.tools) tools.push(tool as unknown as ToolTimelineItem)
    } else if (block.item.type === 'tool-call') {
      tools.push(block.item as unknown as ToolTimelineItem)
    }
  }
  return tools
}

function countDiffRows(item: ToolTimelineItem): { additions: number; deletions: number } {
  const resolved = resolveEditWriteDiffRows(item)
  if (!resolved) {
    if (item.toolName === 'write') {
      const args = normalizeToolArgs(item.toolArgs)
      const content = String(args.content ?? args.new_string ?? args.newString ?? '')
      if (content) {
        const lines = content.split('\n').length
        return { additions: lines, deletions: 0 }
      }
    }
    return { additions: 0, deletions: 0 }
  }
  let additions = 0
  let deletions = 0
  for (const row of resolved.rows) {
    if (row.kind === 'add') additions++
    if (row.kind === 'del') deletions++
  }
  return { additions, deletions }
}

/** Public: +/− line counts for a single mutate tool (edit/write/insert). */
export function countToolDiffStats(item: ToolTimelineItem): { additions: number; deletions: number } {
  const name = (item.toolName || '').toLowerCase()
  if (name !== 'edit' && name !== 'write' && name !== 'insert') {
    return { additions: 0, deletions: 0 }
  }
  return countDiffRows(item)
}

function pathFromTool(item: ToolTimelineItem): string | null {
  if (item.toolDetail && (item.toolDetail.type === 'edit' || item.toolDetail.type === 'write' || item.toolDetail.type === 'read')) {
    const path = item.toolDetail.path
    if (path) return path
  }
  const args = normalizeToolArgs(item.toolArgs)
  const path = fullPathFromArgs(args)
  return path || null
}

/**
 * Build Cursor-like turn activity summary from display blocks + store fileChanges.
 */
export function buildTurnActivitySummary(
  blocks: TimelineDisplayItem[],
  fileChanges: FileChange[],
  opts?: {
    runIds?: Set<string>
    workspaceRoot?: string | null
  },
): TurnActivitySummary {
  const tools = collectToolsFromBlocks(blocks)
  const toolNames = tools.map((tool) => tool.toolName || 'tool').filter(Boolean)
  let searchCount = 0
  let commandCount = 0
  let exploreCount = 0
  for (const tool of tools) {
    const name = tool.toolName || ''
    if (SEARCH_TOOLS.has(name)) searchCount++
    else if (COMMAND_TOOLS.has(name)) commandCount++
    else if (EXPLORE_TOOLS.has(name)) exploreCount++
  }

  const fileMap = new Map<string, TurnFileStat>()
  const runIds = opts?.runIds
  const workspaceRoot = opts?.workspaceRoot

  for (const change of fileChanges) {
    if (runIds && runIds.size > 0 && change.runId && !runIds.has(change.runId)) continue
    if (runIds && runIds.size > 0 && !change.runId) {
      // keep session-scoped entries when no run match yet
    }
    const key = change.path.replace(/\\/g, '/')
    const existing = fileMap.get(key)
    if (existing) {
      existing.changeType = change.changeType || existing.changeType
      existing.runId = change.runId || existing.runId
      continue
    }
    fileMap.set(key, {
      path: change.path,
      displayName: toDisplayPath(change.path, workspaceRoot),
      changeType: change.changeType || 'modified',
      additions: 0,
      deletions: 0,
      runId: change.runId,
      source: 'file-event',
    })
  }

  for (const tool of tools) {
    const name = tool.toolName || ''
    if (!MUTATE_TOOLS.has(name)) continue
    const path = pathFromTool(tool)
    if (!path) continue
    const key = path.replace(/\\/g, '/')
    const stats = countDiffRows(tool)
    // 工具记录中的逐操作 diff（净 diff 缺失时的回退展示）
    const opDiff = resolveEditWriteDiffRows(tool)
    const opDiffs: TurnFileOpDiff[] = opDiff
      ? [{ label: opDiff.label || name, rows: opDiff.rows }]
      : []
    const existing = fileMap.get(key)
    if (existing) {
      existing.additions += stats.additions
      existing.deletions += stats.deletions
      if (opDiffs.length > 0) existing.opDiffs = [...(existing.opDiffs ?? []), ...opDiffs]
      if (!existing.changeType || existing.changeType === 'modified') {
        existing.changeType = name === 'write' ? 'created' : 'modified'
      }
      continue
    }
    fileMap.set(key, {
      path,
      displayName: toDisplayPath(path, workspaceRoot),
      changeType: name === 'write' ? 'created' : 'modified',
      additions: stats.additions,
      deletions: stats.deletions,
      runId: tool.runId,
      source: 'tool',
      ...(opDiffs.length > 0 ? { opDiffs } : {}),
    })
  }

  const files = [...fileMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  return {
    toolNames: [...new Set(toolNames)],
    toolCount: tools.length,
    searchCount,
    commandCount,
    exploreCount,
    files,
    additions,
    deletions,
  }
}

function diffKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * 把 Worker 结算的回合最终净 diff 合并进汇总：
 * - 命中已有文件行：用净 diff 覆盖 +/− 与类型，附加 diff 文本/原因。
 * - 未命中的文件（如未进入工具推导的路径）：追加一行。
 */
export function applyTurnDiffToSummary(
  summary: TurnActivitySummary,
  diffFiles: TurnDiffFile[] | undefined | null,
  workspaceRoot?: string | null,
): TurnActivitySummary {
  if (!diffFiles || diffFiles.length === 0) return summary
  const files = summary.files.map((f) => ({ ...f }))
  const byKey = new Map(files.map((f) => [diffKey(f.path), f]))
  for (const d of diffFiles) {
    const key = diffKey(d.path)
    const existing = byKey.get(key)
    if (existing) {
      existing.source = 'turn-diff'
      existing.changeType = d.status
      existing.additions = d.additions
      existing.deletions = d.deletions
      existing.diffStatus = d.status
      existing.sizeBefore = d.sizeBefore
      existing.sizeAfter = d.sizeAfter
      if (d.diffText != null) {
        existing.diffText = d.diffText
        existing.diffTruncated = d.truncated === true
        // 净 diff 可用：不再需要逐操作回退
        existing.opDiffs = undefined
      }
      if (d.binary) existing.diffBinary = true
      if (d.skipReason) existing.skipReason = d.skipReason
      if (d.skipReason || d.diffText == null || d.binary) {
        existing.additions = 0
        existing.deletions = 0
      }
      continue
    }
    files.push({
      path: d.path,
      displayName: toDisplayPath(d.path, workspaceRoot),
      changeType: d.status,
      additions: d.skipReason || d.binary ? 0 : d.additions,
      deletions: d.skipReason || d.binary ? 0 : d.deletions,
      source: 'turn-diff',
      ...(d.diffText != null ? { diffText: d.diffText, diffTruncated: d.truncated === true } : {}),
      ...(d.binary ? { diffBinary: true } : {}),
      ...(d.skipReason ? { skipReason: d.skipReason } : {}),
      ...(d.status ? { diffStatus: d.status } : {}),
      ...(d.sizeBefore != null ? { sizeBefore: d.sizeBefore } : {}),
      ...(d.sizeAfter != null ? { sizeAfter: d.sizeAfter } : {}),
    })
  }
  files.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return {
    ...summary,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

export function collectRunIdsFromBlocks(blocks: TimelineDisplayItem[]): Set<string> {
  const runIds = new Set<string>()
  for (const block of blocks) {
    if (block.kind === 'tool-group') {
      for (const tool of block.tools) {
        const runId = (tool as { runId?: string }).runId
        if (runId) runIds.add(runId)
      }
    } else if (block.item.type === 'tool-call') {
      const runId = (block.item as { runId?: string }).runId
      if (runId) runIds.add(runId)
    }
  }
  return runIds
}

/** 收集回合块的 turnId（用于回合净 diff 精确匹配；多轮排队共享 runId 时按 turnId 区分）。 */
export function collectTurnIdsFromBlocks(blocks: TimelineDisplayItem[]): string[] {
  const turnIds = new Set<string>()
  for (const block of blocks) {
    if (block.kind === 'tool-group') {
      for (const tool of block.tools) {
        const turnId = (tool as { turnId?: string }).turnId
        if (turnId) turnIds.add(turnId)
      }
    } else if (block.item.type === 'tool-call') {
      const turnId = (block.item as { turnId?: string }).turnId
      if (turnId) turnIds.add(turnId)
    }
  }
  return [...turnIds]
}

export function formatToolVerbList(names: string[], max = 4): string {
  if (names.length === 0) return ''
  const unique = [...new Set(names)]
  if (unique.length <= max) return unique.join(', ')
  return `${unique.slice(0, max).join(', ')} +${unique.length - max}`
}

/**
 * Cursor-style collapsed tool-group line, e.g.
 * "Edited timeline.tsx, explored 3 files, 3 searches, ran 1 command"
 */
export function formatCollapsedToolActivityLine(
  summary: TurnActivitySummary,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = []

  if (summary.files.length > 0) {
    const names = summary.files
      .slice(0, 3)
      .map((file) => file.displayName.split(/[/\\]/).pop() || file.displayName)
      .join(', ')
    parts.push(t('timeline:activity.editedFiles', { count: summary.files.length, names }))
  }
  if (summary.exploreCount > 0) {
    parts.push(t('timeline:activity.explored', { count: summary.exploreCount }))
  }
  if (summary.searchCount > 0) {
    parts.push(t('timeline:activity.searches', { count: summary.searchCount }))
  }
  if (summary.commandCount > 0) {
    parts.push(t('timeline:activity.commands', { count: summary.commandCount }))
  }
  if (parts.length === 0 && summary.toolCount > 0) {
    parts.push(
      t('timeline:activity.usedTools', {
        count: summary.toolCount,
        names: formatToolVerbList(summary.toolNames),
      }),
    )
  }
  return parts.join(', ')
}

/** Build activity summary from a raw tool list (for collapsed tool-group header). */
export function buildToolListActivitySummary(
  tools: ToolTimelineItem[],
  fileChanges: FileChange[] = [],
  workspaceRoot?: string | null,
): TurnActivitySummary {
  const rawBlocks: TimelineDisplayItem[] = [
    {
      kind: 'tool-group',
      groupId: `tg-${tools[0]?.id || 'x'}`,
      tools: tools.map((tool) => ({
        id: tool.id,
        type: 'tool-call',
        toolName: tool.toolName,
        toolPhase: tool.toolPhase,
        toolArgs: tool.toolArgs,
        toolDetail: tool.toolDetail,
        toolOutput: tool.toolOutput,
        runId: tool.runId,
        isError: tool.isError,
      })),
      children: tools.map((tool) => ({
        kind: 'tool' as const,
        item: {
          id: tool.id,
          type: 'tool-call',
          toolName: tool.toolName,
          toolPhase: tool.toolPhase,
          toolArgs: tool.toolArgs,
          toolDetail: tool.toolDetail,
          toolOutput: tool.toolOutput,
          runId: tool.runId,
          isError: tool.isError,
        },
      })),
    },
  ]
  const runIds = new Set(tools.map((tool) => tool.runId).filter((id): id is string => !!id))
  return buildTurnActivitySummary(rawBlocks, fileChanges, {
    runIds,
    workspaceRoot,
  })
}
