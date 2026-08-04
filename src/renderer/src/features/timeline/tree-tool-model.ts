import type {
  SubagentSessionChild,
  SubagentSessionState,
} from '@renderer/lib/subagent-session-types'

export type TreeToolItem = {
  id?: string
  toolCallId?: string
  toolName?: string
  toolOutput?: string
  toolDetails?: unknown
  toolArgs?: unknown
  toolPhase?: string
  toolStatusLine?: string
  isError?: boolean
}

export type TreeToolChildState = SubagentSessionState

export type TreeToolChildView = SubagentSessionChild & {
  error?: string
  failureKind?: 'timedOut' | 'interrupted' | 'stopped'
  toolCount?: number
  tokens?: number
  durationMs?: number
}

export type TreeToolRunView = {
  toolCallId: string
  mode?: string
  runId?: string
  phase: 'running' | 'completed' | 'failed' | 'detached' | 'unknown'
  children: TreeToolChildView[]
  runningCount: number
  completedCount: number
  failedCount: number
  taskCount: number
  hasReliableRunningCount: boolean
  fallbackText?: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is UnknownRecord => !!row) : []
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function legacyState(value: unknown): TreeToolChildState | undefined {
  const state = String(value ?? '').toLowerCase()
  if (state === 'pending' || state === 'queued') return 'pending'
  if (state === 'running' || state === 'working' || state === 'in_progress') return 'running'
  if (state === 'completed' || state === 'complete' || state === 'success' || state === 'succeeded') {
    return 'completed'
  }
  if (state === 'failed' || state === 'error' || state === 'timedout' || state === 'timed_out') {
    return 'failed'
  }
  if (state === 'detached' || state === 'background') return 'detached'
  return undefined
}

function childState(
  result: UnknownRecord,
  progress: UnknownRecord | undefined,
  itemIsLive: boolean,
): Pick<TreeToolChildView, 'state' | 'failureKind'> {
  const progressState = legacyState(progress?.status)
  const resultState = legacyState(result.status ?? result.state)
  if (itemIsLive) return { state: progressState ?? resultState ?? 'pending' }
  if (result.detached === true) return { state: 'detached' }
  if (result.timedOut === true) return { state: 'failed', failureKind: 'timedOut' }
  if (result.interrupted === true) return { state: 'failed', failureKind: 'interrupted' }
  if (result.stopped === true) return { state: 'failed', failureKind: 'stopped' }
  const exitCode = finiteNumber(result.exitCode)
  if (exitCode != null) return { state: exitCode === 0 ? 'completed' : 'failed' }
  if (nonEmptyString(result.error)) return { state: 'failed' }
  if (result.turnBudgetExceeded === true || result.structuredOutputFailed === true) {
    return { state: 'failed' }
  }
  if (asRecord(result.acceptance)?.status === 'rejected') return { state: 'failed' }
  const terminalExplicitState = resultState ?? progressState
  if (terminalExplicitState === 'running' || terminalExplicitState === 'pending') {
    return { state: 'unknown' }
  }
  return { state: terminalExplicitState ?? 'unknown' }
}

function invocationChildren(args: UnknownRecord | undefined): UnknownRecord[] {
  const tasks = asRecordArray(args?.tasks)
  if (tasks.length > 0) return tasks
  const chain = asRecordArray(args?.chain)
  if (chain.length > 0) return chain
  if (args?.agent != null) return [{ agent: args.agent, task: args.task }]
  return []
}

function inferredMode(details: UnknownRecord | undefined, args: UnknownRecord | undefined): string | undefined {
  const declared = nonEmptyString(details?.mode)
  if (declared) return declared
  if (asRecordArray(args?.tasks).length > 0) return 'parallel'
  if (asRecordArray(args?.chain).length > 0) return 'chain'
  if (args?.agent != null) return 'single'
  return undefined
}

export function normalizeTreeToolItem(item: TreeToolItem): TreeToolRunView {
  const details = asRecord(item.toolDetails)
  const args = asRecord(item.toolArgs)
  const resultRows = asRecordArray(details?.results)
  const progressRows = asRecordArray(details?.progress)
  const argumentRows = invocationChildren(args)
  const sourceRows = resultRows.length > 0
    ? resultRows
    : progressRows.length > 0
      ? progressRows
      : argumentRows.length > 0
        ? argumentRows
        : details?.agent != null
          ? [details]
          : []
  const itemIsLive = item.toolPhase === 'start' || item.toolPhase === 'update'
  const detachedLaunch = !itemIsLive && details?.asyncId != null && resultRows.length === 0
  const toolCallId = item.toolCallId || item.id || 'tree-tool'

  const children = sourceRows.map((source, index): TreeToolChildView => {
    const result = resultRows[index] ?? source
    const progress = asRecord(result.progress) ?? progressRows[index]
    const summary = asRecord(result.progressSummary)
    const stateView = detachedLaunch
      ? { state: 'detached' as const }
      : childState(result, progress, itemIsLive)
    return {
      key: `${toolCallId}:${index}`,
      agent:
        nonEmptyString(result.agent)
        ?? nonEmptyString(result.name)
        ?? nonEmptyString(source.agent)
        ?? nonEmptyString(source.name)
        ?? `agent ${index + 1}`,
      task:
        nonEmptyString(result.task)
        ?? nonEmptyString(source.task)
        ?? nonEmptyString(argumentRows[index]?.task),
      ...stateView,
      error: nonEmptyString(result.error),
      toolCount: finiteNumber(progress?.toolCount) ?? finiteNumber(summary?.toolCount),
      tokens: finiteNumber(progress?.tokens) ?? finiteNumber(summary?.tokens),
      durationMs: finiteNumber(progress?.durationMs) ?? finiteNumber(summary?.durationMs),
      sessionFile: nonEmptyString(result.sessionFile) ?? nonEmptyString(source.sessionFile),
    }
  })

  const summary = asRecord(details?.progressSummary)
  const derivedRunning = children.filter((child) => child.state === 'running').length
  const derivedCompleted = children.filter((child) => child.state === 'completed').length
  const derivedFailed = children.filter((child) => child.state === 'failed').length
  const runningCount = finiteNumber(summary?.running) ?? derivedRunning
  const completedCount = finiteNumber(summary?.completed) ?? derivedCompleted
  const failedCount = finiteNumber(summary?.failed) ?? derivedFailed
  const hasReliableRunningCount =
    finiteNumber(summary?.running) != null
    || progressRows.length > 0
    || children.some((child) => child.state === 'running')

  let phase: TreeToolRunView['phase'] = 'unknown'
  if (itemIsLive) phase = 'running'
  else if (detachedLaunch) phase = 'detached'
  else if (failedCount > 0 || item.isError || details?.timedOut === true || details?.stopped === true) phase = 'failed'
  else if (children.length > 0 && children.every((child) => child.state === 'detached')) phase = 'detached'
  else if (children.length > 0 && children.every((child) => child.state === 'completed')) phase = 'completed'

  return {
    toolCallId,
    mode: inferredMode(details, args),
    runId: nonEmptyString(details?.runId) ?? nonEmptyString(details?.asyncId),
    phase,
    children,
    runningCount,
    completedCount,
    failedCount,
    taskCount: children.length,
    hasReliableRunningCount,
    fallbackText: nonEmptyString(item.toolOutput) ?? nonEmptyString(item.toolStatusLine),
  }
}
