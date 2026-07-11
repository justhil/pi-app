import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { markAbortUiHold } from '@renderer/lib/abort-ui-hold'
import { markStreamingAssistantIncomplete } from '@renderer/lib/mark-streaming-incomplete'
import { useUIStore } from '@renderer/stores/ui-store'

/** 对齐 TUI：abort 后立刻让 Composer 可交互（不等 run idle 事件） */
export function applyComposerAbortUi(): void {
  const store = useUIStore.getState()
  // Always clear focus-session turn UI on explicit abort click.
  // Do not gate on composerTurnActive — that can disagree with the Stop button
  // (e.g. sessionRuntimeRunning set but this helper omitted that field).
  markAbortUiHold()
  markStreamingAssistantIncomplete(() => useUIStore.getState(), 'aborted')
  store.setRunState({
    status: 'idle',
    activeRunId: undefined,
    activeTool: undefined,
    activeToolStatus: undefined,
  })
  useUIStore.setState({
    streamingAssistantId: null,
    agentTurnBootstrapping: false,
    optimisticPendingUserText: null,
  })
  store.clearPendingQueue()
  store.markAbortQueueIgnore()
  // Keep incomplete assistants; only drop empty non-incomplete bubbles.
  store.pruneEmptyAssistantBubbles()
  const viewFile = store.historySessionFile
  store.setWorkerLiveSnapshot({
    sessionId: store.currentSessionId,
    sessionFile: viewFile,
    status: 'idle',
  })
  if (viewFile) store.setSessionRuntimeRunning(viewFile, false)
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
  const sessionFile = useUIStore.getState().historySessionFile
  try {
    const res = await ipcClient.invoke('prompt.dequeueClearQueue', {
      abort: !!options?.abort,
      currentText,
      sessionFile: sessionFile ?? undefined,
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
