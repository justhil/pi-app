import { toast } from 'sonner'
import { ipcClient, onAppUpdateAvailable } from '@renderer/lib/ipc-client'

let started = false

export function ensureAppUpdateNotify(): void {
  if (started) return
  started = true

  onAppUpdateAvailable((info) => {
    toast.info(`发现新版本 v${info.latestVersion}（当前 v${info.currentVersion}）`, {
      duration: 12000,
      action: {
        label: '打开发布页',
        onClick: () => {
          void ipcClient.invoke('app.openRelease', { url: info.releaseUrl })
        },
      },
    })
  })
}