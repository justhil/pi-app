import { ipcClient } from '@renderer/lib/ipc-client'

export function reportVisibleSession(sessionFile: string | null): void {
  void ipcClient.invoke('session.setVisible', { sessionFile }).catch(() => {})
}
