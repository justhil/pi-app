/**
 * 过程内容展开窗口（activity window）。
 * 语义：时间线中的过程内容行（工具调用 / 思考块 / 命令执行）默认折叠，
 * 仅自动展开最新的 N 个；新增过程内容时最旧的回到折叠态（滑动窗口）。
 * 用户手动展开/折叠优先于窗口（见 timeline-tool-expand-policy.ts）。
 * N=0 表示禁用窗口（全部保持手动行为）。
 */
export const DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS = 5
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MIN = 0
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MAX = 50

export function normalizeTimelineMaxAutoExpandedTools(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS
  return Math.min(
    TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MAX,
    Math.max(TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MIN, Math.floor(n)),
  )
}
