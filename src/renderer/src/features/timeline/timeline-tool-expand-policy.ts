import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
} from '@shared/timeline-settings'

/** @deprecated 使用 DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS 或设置项 */
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS = DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS

export { normalizeTimelineMaxAutoExpandedTools }

export type ActivityExpandSlot = {
  id: string
  /** 过程行类别：tool-call（工具调用/命令执行）或 thinking（思考块） */
  kind: 'tool' | 'thinking'
}

/**
 * 过程内容滑动窗口（activity window）。
 * 时间线中过程行默认折叠，仅自动展开**最新**的 N 个；有新增时最旧的回到折叠态。
 * 整个时间线统一计数（不按回合分界），静态生效——与 agent 是否在运行无关，
 * 历史会话回放时同样只展开尾部 N 个。
 * maxExpanded=0 → 窗口禁用（全部保持手动行为）。
 * 用户手动展开/折叠（toolExpandBySession）在 ToolCallRow / ThinkingChainBlock 中永远优先。
 */
export function pickAutoExpandedActivityIds(
  slots: ActivityExpandSlot[],
  opts: { maxExpanded?: number },
): Set<string> {
  const max = opts.maxExpanded ?? DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS
  if (max <= 0) return new Set()
  if (slots.length === 0) return new Set()
  return new Set(slots.slice(-max).map((slot) => slot.id))
}
