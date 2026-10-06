/** Token and cost totals (pi `AssistantMessage.usage`; cost in USD as priced by the model entry). */
export type UsageBucket = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; calls: number }

export type UsageSummary = {
  from: number
  to: number
  total: UsageBucket
  /** cacheRead / (input + cacheRead + cacheWrite); null without any input. */
  cacheHitRate: number | null
  byDay: (UsageBucket & { day: string })[]
  byModel: (UsageBucket & { model: string })[]
  byProject: (UsageBucket & { project: string })[]
  topSessions: (UsageBucket & { sessionFile: string; title: string; project: string })[]
}
