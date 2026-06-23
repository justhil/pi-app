import type { ComponentType } from 'react'
import type { ToolTimelineItem } from '@renderer/features/timeline/tool-preview-shell'
import { HashlineToolCardTemplate } from './hashline-tool-preview'

export type AdapterToolCardTemplateId = 'hashline'

const ADAPTER_TOOL_CARD_TEMPLATES: Record<string, ComponentType<{ item: ToolTimelineItem }>> = {
  hashline: HashlineToolCardTemplate,
}

export function getAdapterToolCardTemplate(
  templateId: string | undefined,
): ComponentType<{ item: ToolTimelineItem }> | undefined {
  if (!templateId) return undefined
  return ADAPTER_TOOL_CARD_TEMPLATES[templateId]
}