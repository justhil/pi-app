/** 时间线工具卡条目形状（A 层 + 兼容层模板共用） */
export interface ToolTimelineItem {
  id?: string
  toolName?: string
  toolOutput?: string
  toolDetails?: any
  toolArgs?: any
  toolPhase?: string
  toolStatusLine?: string
  runId?: string
  isError?: boolean
}