import type { FileChange, ToolTimelineItem } from '@renderer/stores/ui-store-types'
import type { TimelineDisplayItem } from './timeline-display-items'
import { resolveEditWriteDiffRows } from '@extension-compat/renderer/native-diff'
import { fullPathFromArgs, normalizeToolArgs } from '@extension-compat/renderer/tool-output'

export type TurnFileStat = {
  path: string
  /** repo-relative display path */
  displayName: string
  changeType: string
  additions: number
  deletions: number
  runId?: string
  source: 'file-event' | 'tool'
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
    const existing = fileMap.get(key)
    if (existing) {
      existing.additions += stats.additions
      existing.deletions += stats.deletions
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
