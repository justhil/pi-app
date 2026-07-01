import { ipcClient } from '@renderer/lib/ipc-client'
import { alertTrace } from '@renderer/lib/alert-trace'

export type DesktopAlertKind = 'extension_ui' | 'run_idle'

let lastExtensionUiAt = 0
const EXTENSION_UI_COOLDOWN_MS = 3000

/** 经主进程播放提示音 / 系统通知（受设置 → 常规 开关控制） */
export async function signalDesktopAlert(
  kind: DesktopAlertKind,
  payload: { title: string; body: string },
): Promise<void> {
  if (kind === 'extension_ui') {
    const now = Date.now()
    if (now - lastExtensionUiAt < EXTENSION_UI_COOLDOWN_MS) return
    lastExtensionUiAt = now
  }
  alertTrace('ipc alerts.signal', { kind, title: payload.title, body: payload.body?.slice(0, 80) })
  try {
    await ipcClient.invoke('alerts.signal', { kind, ...payload })
  } catch {
    /* ignore */
  }
}