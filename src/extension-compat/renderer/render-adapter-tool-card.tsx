import type { ReactNode } from 'react'
import type { ToolTimelineItem } from '@renderer/features/timeline/tool-preview-shell'
import { shouldRenderHashlineProtocol } from './hashline-protocol'
import { getAdapterToolCardTemplate } from './tool-card-template-registry'

/** 仅当 adapter 声明的 template + 协议检测通过时渲染；否则返回 null 走 A 层 native */
export function tryRenderAdapterToolCard(item: ToolTimelineItem, templateId: string | undefined): ReactNode | null {
  if (!templateId) return null
  const Comp = getAdapterToolCardTemplate(templateId)
  if (!Comp) return null

  if (templateId === 'hashline') {
    const name = item.toolName || ''
    if (!shouldRenderHashlineProtocol(name, item.toolOutput || '', item.toolArgs)) return null
  }

  return <Comp item={item} />
}