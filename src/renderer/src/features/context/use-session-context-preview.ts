import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionContextPreview } from '@shared/session-context-preview'
import { ipcClient } from '@renderer/lib/ipc-client'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'

const RUNNING_CONTEXT_REFRESH_MS = 8000

export function useSessionContextPreview(options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false
  const workspace = useUIStore((state) => state.currentWorkspace)
  const sessionFile = useUIStore((state) => state.historySessionFile)
  const historyLoading = useUIStore((state) => state.historyLoading)
  const isRunning = useUIStore((state) => state.runState.status === 'running')
  const [preview, setPreview] = useState<SessionContextPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || !workspace || !sessionFile || historyLoading) return
    if (typeof document !== 'undefined' && document.hidden) return
    const requestId = ++requestIdRef.current
    const requestedFile = sessionFile
    setLoading(true)
    try {
      const response = await ipcClient.invoke('context.preview', {
        sessionFile: requestedFile,
        workspaceId: workspace,
      })
      if (requestId !== requestIdRef.current) return
      const next = (response?.preview || null) as SessionContextPreview | null
      setPreview(next && sessionFilesEqual(next.sessionFile, requestedFile) ? next : null)
    } catch {
      if (requestId === requestIdRef.current) setPreview(null)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [enabled, workspace, sessionFile, historyLoading])

  useEffect(() => {
    requestIdRef.current += 1
    setPreview(null)
    setLoading(false)
    return () => {
      requestIdRef.current += 1
    }
  }, [enabled, workspace, sessionFile, historyLoading])

  useEffect(() => {
    if (!enabled || !workspace || !sessionFile || historyLoading) return
    void refresh()
    const intervalId = isRunning
      ? window.setInterval(() => void refresh(), RUNNING_CONTEXT_REFRESH_MS)
      : null
    const onVisibility = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (intervalId != null) window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, workspace, sessionFile, historyLoading, isRunning, refresh])

  return { preview, loading, refresh }
}
