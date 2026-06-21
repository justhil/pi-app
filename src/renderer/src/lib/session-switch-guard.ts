import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'
import { extensionUIBlocksSessionSwitch } from '@renderer/stores/extension-ui-store'

/** 启动后短暂不 toast，避免误拦自动切会话时连响 */
const STARTUP_GUARD_QUIET_MS = 2500
let guardQuietUntil = Date.now() + STARTUP_GUARD_QUIET_MS

export function markSessionSwitchGuardReady(): void {
  guardQuietUntil = Date.now() + STARTUP_GUARD_QUIET_MS
}

export function guardSessionSwitch(action: () => void, options?: { silentBlock?: boolean }): void {
  const running = useUIStore.getState().runState.status === 'running'
  if (!extensionUIBlocksSessionSwitch(running)) {
    action()
    return
  }
  const silent = options?.silentBlock || Date.now() < guardQuietUntil
  if (silent) return
  if (running) {
    toast.message('当前会话仍在运行，请等待结束或中止后再切换')
    return
  }
  toast.message('请先完成或处理扩展问答（点击时间线「继续作答」）')
}