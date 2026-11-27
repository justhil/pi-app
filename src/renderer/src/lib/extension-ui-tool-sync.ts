import { useUIStore } from '@renderer/stores/ui-store'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { currentAdapterCatalog } from '@renderer/lib/adapter-catalog'

const FALLBACK_INTERACTIVE_TOOLS = new Set(['ask_user_question', 'image_review'])

/** Resolve all tool names declared via adapter `interact.trigger.tool`, plus core fallbacks. */
export function getInteractiveExtensionTools(): Set<string> {
  const names = new Set(FALLBACK_INTERACTIVE_TOOLS)
  for (const adapter of currentAdapterCatalog()) {
    const tool = adapter.interact?.trigger?.tool?.trim()
    if (tool) names.add(tool)
  }
  return names
}

/** Resolve tool names whose adapter `interact.schema` maps to a desktop dialog method. */
export function interactiveToolsForDialogMethod(method: string): Set<string> {
  const targetSchema =
    method === 'ask_user_question'
      ? 'questions'
      : method === 'image_review'
        ? 'review'
        : null
  const out = new Set<string>()
  if (FALLBACK_INTERACTIVE_TOOLS.has(method)) out.add(method)
  if (!targetSchema) return out
  for (const adapter of currentAdapterCatalog()) {
    if (adapter.interact?.schema === targetSchema && adapter.interact.trigger?.tool) {
      out.add(adapter.interact.trigger.tool)
    }
  }
  return out
}

export function isInteractiveExtensionTool(toolName: string | undefined): boolean {
  if (!toolName) return false
  return getInteractiveExtensionTools().has(toolName)
}

/** 弹窗打开时绑定到最近一条仍在运行的交互式工具行（优先按 toolCallId 精准匹配，其次按适配器声明工具名匹配） */
export function linkExtensionDialogToToolRow(
  requestId: string,
  dialogMethod: string,
  toolCallId?: string,
): void {
  const items = useUIStore.getState().timelineItems
  const candidateTools = interactiveToolsForDialogMethod(dialogMethod)
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type !== 'tool-call') continue
    if (it.toolPhase !== 'start' && it.toolPhase !== 'update') continue
    const matchesCall = Boolean(toolCallId && it.toolCallId === toolCallId)
    const matchesTool = Boolean(it.toolName && candidateTools.has(it.toolName))
    if (!matchesCall && !matchesTool) continue
    useUIStore.getState().updateTimelineItem(it.id, {
      extensionUiRequestId: requestId,
      extensionUiSuspended: false,
    })
    return
  }
}

export function clearExtensionToolRowFlags(timelineItemId?: string): void {
  if (!timelineItemId) return
  useUIStore.getState().updateTimelineItem(timelineItemId, {
    extensionUiSuspended: false,
    extensionUiRequestId: undefined,
  })
}

/**
 * 扩展 UI 已关闭且 Worker 未再推 tool end 时，避免交互工具行一直转圈。
 * 延迟一帧，优先让正常的 tool_execution_end 事件先落地。
 */
function finishStaleRow(it: { id: string }): void {
  useUIStore.getState().updateTimelineItem(it.id, {
    toolPhase: 'end',
    extensionUiSuspended: false,
    extensionUiRequestId: undefined,
    toolStatusLine: undefined,
  })
}

export function reconcileStaleInteractiveToolRows(requestId?: string): void {
  requestAnimationFrame(() => {
    const { activePending, suspended } = useExtensionUIStore.getState()
    if (activePending || suspended) return

    const interactiveTools = getInteractiveExtensionTools()
    const items = useUIStore.getState().timelineItems
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.type !== 'tool-call') continue
      if (!interactiveTools.has(it.toolName || '')) continue
      if (it.toolPhase !== 'start' && it.toolPhase !== 'update') continue
      if (requestId && it.extensionUiRequestId && it.extensionUiRequestId !== requestId) continue
      finishStaleRow(it)
      return
    }
  })
}

export function reconcileAllStaleInteractiveToolRows(): void {
  requestAnimationFrame(() => {
    const { activePending, suspended } = useExtensionUIStore.getState()
    if (activePending || suspended) return
    const interactiveTools = getInteractiveExtensionTools()
    const items = useUIStore.getState().timelineItems
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.type !== 'tool-call') continue
      if (!interactiveTools.has(it.toolName || '')) continue
      if (it.toolPhase !== 'start' && it.toolPhase !== 'update') continue
      finishStaleRow(it)
    }
  })
}

export function findRunningInteractiveToolRow(toolName: string): string | undefined {
  const items = useUIStore.getState().timelineItems
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type !== 'tool-call') continue
    if (it.toolName !== toolName) continue
    if (it.toolPhase === 'start' || it.toolPhase === 'update') return it.id
  }
  return undefined
}
