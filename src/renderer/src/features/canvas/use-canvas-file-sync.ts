import { useCallback, useEffect, useId, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { subscribeCanvasFileChanges } from './use-canvas-events'

export interface CanvasFileSyncState {
  content: string | null
  dataUrl: string | null
  absPath: string | null
  mtimeMs: number | null
  loading: boolean
  watching: boolean
  error: string | null
  reload: () => void
}

/**
 * Load a local file referenced by `filePath` through the validated main-process channel
 * (`ipc:canvas.file.read`) and optionally keep it hot-reloaded via `ipc:canvas.file.watch`.
 */
export function useCanvasFileSync(opts: {
  filePath?: string
  watch?: boolean
  mode: 'text' | 'image' | 'auto'
}): CanvasFileSyncState {
  const { filePath, watch = false, mode } = opts
  const workspaceRoot = useUIStore((s) => s.currentWorkspace)
  const watchId = useId()

  const [content, setContent] = useState<string | null>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [absPath, setAbsPath] = useState<string | null>(null)
  const [mtimeMs, setMtimeMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [watching, setWatching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const reload = useCallback(() => {
    setReloadTick((n) => n + 1)
  }, [])

  useEffect(() => {
    const trimmed = filePath?.trim()
    if (!trimmed) {
      setContent(null)
      setDataUrl(null)
      setAbsPath(null)
      setMtimeMs(null)
      setLoading(false)
      setWatching(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void ipcClient
      .invoke('canvas.file.read', {
        filePath: trimmed,
        workspaceRoot: workspaceRoot ?? null,
        mode,
      })
      .then((res) => {
        if (cancelled) return
        if (!res?.ok) {
          setError(String(res?.error || 'file_read_failed'))
          setLoading(false)
          return
        }
        setContent(typeof res.content === 'string' ? res.content : null)
        setDataUrl(typeof res.dataUrl === 'string' ? res.dataUrl : null)
        setAbsPath(typeof res.absPath === 'string' ? res.absPath : null)
        setMtimeMs(typeof res.mtimeMs === 'number' ? res.mtimeMs : null)
        setError(null)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [filePath, workspaceRoot, mode, reloadTick])

  useEffect(() => {
    const trimmed = filePath?.trim()
    if (!trimmed || !watch) {
      setWatching(false)
      return
    }

    let disposed = false
    const unsub = subscribeCanvasFileChanges((ev) => {
      if (ev.watchId !== watchId) return
      if (ev.error) {
        setError(ev.error)
        return
      }
      if (typeof ev.content === 'string') setContent(ev.content)
      if (typeof ev.dataUrl === 'string') setDataUrl(ev.dataUrl)
      if (typeof ev.mtimeMs === 'number') setMtimeMs(ev.mtimeMs)
      setError(null)
    })

    void ipcClient
      .invoke('canvas.file.watch', {
        watchId,
        filePath: trimmed,
        workspaceRoot: workspaceRoot ?? null,
        mode,
      })
      .then((res) => {
        if (!disposed) setWatching(Boolean(res?.ok))
      })
      .catch(() => {
        if (!disposed) setWatching(false)
      })

    return () => {
      disposed = true
      setWatching(false)
      unsub()
      void ipcClient.invoke('canvas.file.unwatch', { watchId }).catch(() => {})
    }
  }, [filePath, watch, workspaceRoot, mode, watchId])

  return { content, dataUrl, absPath, mtimeMs, loading, watching, error, reload }
}
