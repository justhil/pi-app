/** Token and cost totals (pi `AssistantMessage.usage`; cost in USD as priced by the model entry). */
/** `reasoning` is a subset of `output` (only providers that report it). */
export type UsageBucket = { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number; calls: number }

export type UsageSummary = {
  from: number
  to: number
  total: UsageBucket
  /** cacheRead / (input + cacheRead + cacheWrite); null without any input. */
  cacheHitRate: number | null
  /** Days with at least one reply, and sessions with any usage, in range. */
  activeDays: number
  sessions: number
  /** First reply ever recorded (any range), for "all time". */
  firstAt: number | null
  byDay: (UsageBucket & { day: string })[]
  /** Weekday (Monday = 0) × local hour, index `weekday * 24 + hour`. */
  heat: { calls: number[]; cost: number[]; tokens: number[] }
  byModel: (UsageBucket & { model: string })[]
  byProject: (UsageBucket & { project: string })[]
  topSessions: (UsageBucket & { sessionFile: string; title: string; project: string })[]
}
