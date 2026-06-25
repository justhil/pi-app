import { useUIStore } from '@renderer/stores/ui-store'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'

export const INTERACTIVE_EXTENSION_TOOLS = new Set(['ask_user_question', 'image_review'])

/** 弹窗打开时绑定到最近一条仍在运行的交互式工具行 */
export function linkExtensionDialogToToolRow(requestId: string, toolName: string): void {
  const items = useUIStore.getState().timelineItems
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type !== 'tool-call') continue
    if (it.toolName !== toolName) continue
    if (it.toolPhase !== 'start' && it.toolPhase !== 'update') continue
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

    const items = useUIStore.getState().timelineItems
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.type !== 'tool-call') continue
      if (!INTERACTIVE_EXTENSION_TOOLS.has(it.toolName || '')) continue
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
    const items = useUIStore.getState().timelineItems
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.type !== 'tool-call') continue
      if (!INTERACTIVE_EXTENSION_TOOLS.has(it.toolName || '')) continue
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