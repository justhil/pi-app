// Tool card component registry (兼容层 v2 工具卡查表层 — docs/adapter-layer-plan.md §4.2/§7)
// 收敛 timeline 的 if(toolName===) 链为注册表查询。特殊卡片在此登记；未登记走 default。
// 长期目标：这些登记项由 adapter.json toolCard.template + 模板实现取代；当前为过渡查表层。
import type { ComponentType } from 'react'
import { ImageToolCard } from './image-tool-card'
import { SubagentToolCard } from './subagent-tool-card'

interface ToolItem {
  toolName?: string
  toolOutput?: string
  toolDetails?: any
  toolPhase?: string
  toolStatusLine?: string
  isError?: boolean
}

type ToolCardComponent = ComponentType<{ item: ToolItem }>

// toolName → specialized card component (declared here, not inline if-chains)
const TOOL_CARD_REGISTRY: Record<string, ToolCardComponent> = {
  image_gen: ImageToolCard,
  image_review: ImageToolCard,
  analyze_image: ImageToolCard,
  subagent: SubagentToolCard,
  trellis_subagent: SubagentToolCard,
  contact_supervisor: SubagentToolCard,
}

export function resolveToolCard(toolName: string | undefined): ToolCardComponent | null {
  if (!toolName) return null
  return TOOL_CARD_REGISTRY[toolName] || null
}

export const EXPORT_TOOLS = new Set(['preview_export', 'studio_export_pdf', 'studio_export_html'])
export const ASK_TOOL = 'ask_user_question'
