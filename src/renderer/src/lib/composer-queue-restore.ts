import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** 对齐 TUI restoreQueuedMessagesToEditor：清空 Worker 队列，合并进输入框 */
export async function restoreQueuedToComposer(options?: {
  abort?: boolean
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
    useUIStore.getState().clearPendingQueue()
    if (combined && options?.setText) options.setText(combined)
    if (n > 0) toast.info(`已拉回 ${n} 条排队消息到输入框`)
    else if (!options?.abort) toast.message('没有可拉回的排队消息')
    return n
  } catch (e) {
    console.error('dequeueClearQueue failed', e)
    toast.error('拉回队列失败')
    return 0
  }
}