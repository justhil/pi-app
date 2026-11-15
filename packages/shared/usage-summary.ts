/** Token and cost totals (pi `AssistantMessage.usage`; cost in USD as priced by the model entry). */
/** `reasoning` is a subset of `output` (only providers that report it). */
export type UsageBucket = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  cost: number
  calls: number
}

export type UsageCostBreakdown = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type UsagePerfMetrics = {
  /** Subset of `cacheWrite` billed at 1h retention when reported by the provider. */
  cacheWrite1h: number
  costBreakdown: UsageCostBreakdown
  /** Completed replies (`stop`, `toolUse`, `length`). */
  successCalls: number
  errorCalls: number
  abortedCalls: number
  lengthCalls: number
  /** `cacheRead / (input + cacheRead + cacheWrite)`; null when prompt tokens = 0. */
  cacheHitRate: number | null
  /** `cacheWrite / (input + cacheRead + cacheWrite)`; null when prompt tokens = 0. */
  writeCacheRate: number | null
  /** Count of non-aborted/non-error calls carrying valid latency. */
  durationCalls: number
  avgDurationMs: number | null
  p50DurationMs: number | null
  /** Count of non-aborted/non-error calls carrying measured TTFT. */
  ttftCalls: number
  avgTtftMs: number | null
  p50TtftMs: number | null
  p90TtftMs: number | null
  /** Weighted end-to-end throughput (`Σ output / Σ durationSec`) across valid completed calls. */
  totalTps: number | null
  /** Weighted streaming decode throughput (`Σ streamedTokens / Σ decodeSec`) across calls with TTFT. */
  genTps: number | null
}

export type UsageStatsBucket = UsageBucket & UsagePerfMetrics

export type UsageSummary = {
  from: number
  to: number
  total: UsageStatsBucket
  /** `cacheRead / (input + cacheRead + cacheWrite)`; null without any input. */
  cacheHitRate: number | null
  /** Days with at least one reply, and sessions with any usage, in range. */
  activeDays: number
  sessions: number
  /** First reply ever recorded (any range), for "all time". */
  firstAt: number | null
  byDay: (UsageStatsBucket & { day: string })[]
  /** Weekday (Monday = 0) × local hour, index `weekday * 24 + hour`. */
  heat: { calls: number[]; cost: number[]; tokens: number[] }
  byModel: (UsageStatsBucket & { model: string; provider: string; modelId: string })[]
  byProject: (UsageStatsBucket & { project: string })[]
  topSessions: (UsageStatsBucket & { sessionFile: string; title: string; project: string })[]
}

export type UsageStopStatus = 'ok' | 'error' | 'aborted' | 'length'

export type UsageLogSortField =
  | 'ts'
  | 'tokens'
  | 'cacheRead'
  | 'cacheWrite'
  | 'duration'
  | 'ttft'
  | 'tps'
  | 'cost'

export type UsageLogQuery = {
  /** Days back from today; 0 = all time. */
  days?: number
  model?: string
  project?: string
  api?: string
  status?: 'all' | UsageStopStatus
  search?: string
  sortBy?: UsageLogSortField
  sortDir?: 'asc' | 'desc'
  offset?: number
  limit?: number
}

export type UsageLogRow = {
  id: string
  sessionFile: string
  entryId: string
  parentId: string | null
  sessionTitle: string
  project: string
  ts: number
  api: string
  provider: string
  model: string
  modelId: string
  responseModel?: string
  responseId?: string
  thinkingLevel?: string
  stopReason: string
  status: UsageStopStatus
  errorMessage?: string
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
  totalTokens: number
  cacheHitRate: number | null
  writeCacheRate: number | null
  cost: number
  costBreakdown: UsageCostBreakdown & { totalFromProvider?: boolean }
  durationMs: number | null
  ttftMs: number | null
  firstTokenKind?: 'thinking' | 'text' | 'toolCall'
  totalTps: number | null
  genTps: number | null
}

export type UsageLogPage = {
  totalCount: number
  offset: number
  limit: number
  rows: UsageLogRow[]
  facets: {
    models: string[]
    projects: string[]
    apis: string[]
  }
}

export type UsageMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id: string; name: string; arguments: unknown }
  | { type: 'image'; mimeType: string; bytes: number }

export type UsageContextMessageItem = {
  index: number
  role: string
  timestamp?: number
  toolName?: string
  toolCallId?: string
  isError?: boolean
  summary?: string
  blocks: UsageMessageBlock[]
}

export type UsageRequestDetail = {
  sessionFile: string
  sessionId: string | null
  sessionTitle: string
  project: string
  entryId: string
  parentId: string | null
  model: { provider: string; modelId: string } | null
  thinkingLevel?: string
  request: {
    totalMessages: number
    /** Index of the first message belonging to the current turn's trigger (after the previous assistant prose). */
    focusStartIndex: number
    systemSections: { name: string; content: string | null }[]
    toolsDeclared: { added: { name: string; description?: string }[]; removed: string[] }
    messages: UsageContextMessageItem[]
    rawContextJson: unknown
  }
  response: {
    blocks: UsageMessageBlock[]
    toolResults: {
      toolCallId: string
      toolName: string
      isError: boolean
      text: string
      durationMs?: number
    }[]
    diagnostics?: { type: string; message: string }[]
    errorMessage?: string
    rawMessageJson: unknown
  }
}
