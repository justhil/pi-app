import { useEffect, useState, type ReactElement } from 'react'
import type { AppUpdateAvailableInfo } from '@shared/app-update'
import { ipcClient, onAppUpdateAvailable } from '@renderer/lib/ipc-client'
import { AppUpdateDialog } from '@renderer/features/shell/app-update-dialog'

/** Boot hook (main.tsx): keeps legacy import; real UI is AppUpdateHost. */
export function ensureAppUpdateNotify(): void {
  /* no-op: subscription lives in AppUpdateHost under React tree */
}

/** Imperative open for Settings "Check for updates". */
let openUpdateDialog: ((info: AppUpdateAvailableInfo) => void) | null = null

export function showAppUpdateDialog(info: AppUpdateAvailableInfo): void {
  openUpdateDialog?.(info)
}

export function AppUpdateHost(): ReactElement | null {
  const [info, setInfo] = useState<AppUpdateAvailableInfo | null>(null)

  useEffect(() => {
    openUpdateDialog = (next) => setInfo(next)

    const unsubscribe = onAppUpdateAvailable((payload) => {
      setInfo(payload)
    })

    // Pull buffered auto-check result if main finished before React subscribed
    void ipcClient
      .invoke('app.getPendingUpdate', {})
      .then((response: { update?: AppUpdateAvailableInfo | null } | null) => {
        if (response?.update) setInfo(response.update)
      })
      .catch(() => {
        /* silent */
      })

    return () => {
      openUpdateDialog = null
      unsubscribe()
    }
  }, [])

  if (!info) return null

  const dismiss = () => {
    setInfo(null)
    void ipcClient.invoke('app.dismissUpdatePrompt', {}).catch(() => {
      /* silent */
    })
  }

  return <AppUpdateDialog info={info} onDismiss={dismiss} />
}
