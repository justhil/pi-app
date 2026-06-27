import { ipcClient } from '@renderer/lib/ipc-client'

export function startupLogRenderer(
  level: 'info' | 'warn' | 'error',
  phase: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  void ipcClient.invoke('diagnostics.startupLog', { level, phase, message, detail }).catch(() => {})
}