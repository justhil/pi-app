import { useEffect, useRef, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { formatTokens, estTokensFromChars } from '@renderer/lib/format-tokens'
import type { ContextRoleSlice } from '@renderer/features/run/context-donut'

export type ContextPreview = {
  messageCount: number
  estimatedChars: number
  roleBreakdown?: ContextRoleSlice[]
}

const RUNNING_CONTEXT_REFRESH_MS = 8000

export function useComposerMetrics(options?: { enabled?: boolean }) {
  const metricsEnabled = options?.enabled !== false
  const workspace = useUIStore((s) => s.currentWorkspace)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const model = useUIStore((s) => s.runState.model)
  const usage = useUIStore((s) => s.runState.usage)
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const historyLoading = useUIStore((s) => s.historyLoading)
  const streamingId = useUIStore((s) => s.streamingAssistantId)
  const streamLen = useUIStore((s) => {
    if (!s.streamingAssistantId) return 0
    const item = s.timelineItems.find((i) => i.id === s.streamingAssistantId)
    return item?.text?.length ?? 0
  })

  const [contextPreview, setContextPreview] = useState<ContextPreview | null>(null)
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [tps, setTps] = useState<number | null>(null)

  const streamRef = useRef({ id: null as string | null, start: 0, lastLen: 0, lastAt: 0 })

  useEffect(() => {
    if (!metricsEnabled || !workspace) {
      setContextPreview(null)
      return
    }
    let cancelled = false
    const load = () => {
      if (historyLoading) return
      if (typeof document !== 'undefined' && document.hidden) return
      ipcClient
        .invoke('context.preview')
        .then((r) => {
          if (!cancelled && r?.preview) {
            const rawBreakdown = Array.isArray(r.preview.roleBreakdown)
              ? (r.preview.roleBreakdown as ContextRoleSlice[])
              : undefined
            setContextPreview({
              messageCount: r.preview.messageCount ?? 0,
              estimatedChars: r.preview.estimatedChars ?? 0,
              roleBreakdown: rawBreakdown,
            })
          }
        })
        .catch(() => {})
    }
    // One-shot on session / history settle; poll only while the turn is running and visible.
    load()
    if (!isRunning) {
      return () => {
        cancelled = true
      }
    }
    const intervalId = window.setInterval(load, RUNNING_CONTEXT_REFRESH_MS)
    const onVisibility = () => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [metricsEnabled, workspace, currentSessionId, historyLoading, isRunning])

  useEffect(() => {
    if (!metricsEnabled || !workspace || !model) {
      setContextWindow(null)
      return
    }
    ipcClient
      .invoke('model.list', {})
      .then((r) => {
        const models = (r?.models || []) as { id: string; name: string; contextWindow?: number }[]
        const matchedModel =
          models.find((entry) => entry.id === model || entry.name === model) ||
          models.find((entry) => model.includes(entry.id) || entry.name?.includes(model))
        setContextWindow(
          matchedModel?.contextWindow && matchedModel.contextWindow > 0
            ? matchedModel.contextWindow
            : null,
        )
      })
      .catch(() => setContextWindow(null))
  }, [metricsEnabled, workspace, model])

  useEffect(() => {
    if (!metricsEnabled) {
      setTps(null)
      return
    }
    const now = performance.now()
    if (!streamingId) {
      streamRef.current = { id: null, start: 0, lastLen: 0, lastAt: 0 }
      if (!isRunning) setTps(null)
      return
    }
    const streamState = streamRef.current
    if (streamState.id !== streamingId) {
      streamState.id = streamingId
      streamState.start = now
      streamState.lastLen = streamLen
      streamState.lastAt = now
      setTps(null)
      return
    }
    const elapsedSeconds = (now - streamState.lastAt) / 1000
    const deltaChars = streamLen - streamState.lastLen
    if (elapsedSeconds >= 0.25 && deltaChars > 0) {
      const instantRate = deltaChars / elapsedSeconds
      setTps((previous) => (previous == null ? instantRate : previous * 0.65 + instantRate * 0.35))
      streamState.lastLen = streamLen
      streamState.lastAt = now
    }
  }, [metricsEnabled, streamingId, streamLen, isRunning])

  const estimatedContextTokens = contextPreview ? estTokensFromChars(contextPreview.estimatedChars) : null
  const contextPercent =
    estimatedContextTokens != null && contextWindow != null && contextWindow > 0
      ? Math.min(100, (estimatedContextTokens / contextWindow) * 100)
      : null

  const cacheHitPercent = (() => {
    if (!usage) return null
    const denominator = usage.input + usage.cacheRead
    if (denominator <= 0) return null
    return (usage.cacheRead / denominator) * 100
  })()

  return {
    contextPreview,
    estContextTokens: estimatedContextTokens,
    contextWindow,
    ctxPct: contextPercent,
    cacheHitPct: cacheHitPercent,
    cacheWrite: usage?.cacheWrite ?? 0,
    tps,
    formatTokens,
  }
}
