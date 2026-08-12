import { useEffect, useRef, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { formatTokens, estTokensFromChars } from '@renderer/lib/format-tokens'
import type { ContextRoleSlice } from '@renderer/features/run/context-donut'
import { useSessionContextPreview } from '@renderer/features/context/use-session-context-preview'

export function useComposerMetrics(options?: { enabled?: boolean }) {
  const metricsEnabled = options?.enabled !== false
  const workspace = useUIStore((s) => s.currentWorkspace)
  const model = useUIStore((s) => s.runState.model)
  const usage = useUIStore((s) => s.runState.usage)
  const isRunning = useUIStore((s) => s.runState.status === 'running')
  const streamingId = useUIStore((s) => s.streamingAssistantId)
  const streamLen = useUIStore((s) => {
    if (!s.streamingAssistantId) return 0
    const item = s.timelineItems.find((i) => i.id === s.streamingAssistantId)
    return item?.text?.length ?? 0
  })

  const { preview: rawContextPreview } = useSessionContextPreview({ enabled: metricsEnabled })
  const contextPreview = rawContextPreview
    ? {
        messageCount: rawContextPreview.messageCount,
        estimatedChars: rawContextPreview.estimatedChars,
        roleBreakdown: rawContextPreview.roleBreakdown as ContextRoleSlice[],
      }
    : null
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [tps, setTps] = useState<number | null>(null)

  const streamRef = useRef({ id: null as string | null, start: 0, lastLen: 0, lastAt: 0 })

  useEffect(() => {
    if (!metricsEnabled || !workspace || !model) {
      setContextWindow(null)
      return
    }
    ipcClient
      .invoke('model.list', { scope: 'catalog' })
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
