import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'

/** 仅 Agent 运行中禁止切换会话；已停止或扩展挂起不拦截 */
export function guardSessionSwitch(action: () => void): void {
  if (useUIStore.getState().runState.status !== 'running') {
    action()
    return
  }
  toast.message('当前会话仍在运行，请等待结束或中止后再切换')
}