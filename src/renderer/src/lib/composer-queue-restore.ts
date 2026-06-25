import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** 对齐 TUI：abort 后立刻让 Composer 可交互（不等 run idle 事件） */
export function applyComposerAbortUi(): void {
  const store = useUIStore.getState()
  store.setRunState({
    status: 'idle',
    activeRunId: undefined,
    activeTool: undefined,
    activeToolStatus: undefined,
  })
  useUIStore.setState({ streamingAssistantId: null, agentTurnBootstrapping: false })
  store.clearPendingQueue()
  store.markAbortQueueIgnore()
  store.pruneEmptyAssistantBubbles()
  void import('@renderer/lib/extension-ui-tool-sync').then((m) => m.reconcileAllStaleInteractiveToolRows())
}

/** 对齐 TUI restoreQueuedMessagesToEditor：清空 Worker 队列，合并进输入框 */
export async function restoreQueuedToComposer(options?: {
  abort?: boolean
  /** 停止任务后自动拉回，不弹 toast */
  quiet?: boolean
  currentText?: string
  setText?: (v: string) => void
}): Promise<number> {
  const currentText = options?.currentText ?? ''
  try {
    const res = await ipcClient.invoke('prompt.dequeueClearQueue', {
      abort: !!options?.abort,
      currentText,
    })
    const n = res?.restoredCount ?? 0
    const combined = res?.combinedText ?? ''
    if (!options?.abort) useUIStore.getState().clearPendingQueue()
    if (combined && options?.setText) options.setText(combined)
    if (!options?.quiet) {
      if (n > 0 && !options?.abort) toast.info(`已拉回 ${n} 条排队消息到输入框`)
      else if (!options?.abort) toast.message('没有可拉回的排队消息')
    }
    return n
  } catch (e) {
    console.error('dequeueClearQueue failed', e)
    toast.error('拉回队列失败')
    return 0
  }
}