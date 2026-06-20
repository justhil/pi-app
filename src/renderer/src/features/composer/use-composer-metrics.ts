import { useEffect, useRef, useState } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { formatTokens, estTokensFromChars } from '@renderer/lib/format-tokens'

export type ContextPreview = {
  messageCount: number
  estimatedChars: number
}

export function useComposerMetrics() {
  const workspace = useUIStore((s) => s.currentWorkspace)
  const currentSessionId = useUIStore((s) => s.currentSessionId)
  const model = useUIStore((s) => s.runState.model)
  const usage = useUIStore((s) => s.runState.usage)
  const isRunning = useUIStore((s) => s.runState.status === 'running')
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
    if (!workspace) {
      setContextPreview(null)
      return
    }
    let cancelled = false
    const load = () => {
      ipcClient
        .invoke('context.preview')
        .then((r) => {
          if (!cancelled && r?.preview) {
            setContextPreview({
              messageCount: r.preview.messageCount ?? 0,
              estimatedChars: r.preview.estimatedChars ?? 0,
            })
          }
        })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [workspace, currentSessionId])

  useEffect(() => {
    if (!workspace || !model) {
      setContextWindow(null)
      return
    }
    ipcClient
      .invoke('model.list', {})
      .then((r) => {
        const models = (r?.models || []) as { id: string; name: string; contextWindow?: number }[]
        const m =
          models.find((x) => x.id === model || x.name === model) ||
          models.find((x) => model.includes(x.id) || x.name?.includes(model))
        setContextWindow(m?.contextWindow && m.contextWindow > 0 ? m.contextWindow : null)
      })
      .catch(() => setContextWindow(null))
  }, [workspace, model])

  useEffect(() => {
    const now = performance.now()
    if (!streamingId) {
      streamRef.current = { id: null, start: 0, lastLen: 0, lastAt: 0 }
      if (!isRunning) setTps(null)
      return
    }
    const s = streamRef.current
    if (s.id !== streamingId) {
      s.id = streamingId
      s.start = now
      s.lastLen = streamLen
      s.lastAt = now
      setTps(null)
      return
    }
    const dt = (now - s.lastAt) / 1000
    const dChars = streamLen - s.lastLen
    if (dt >= 0.25 && dChars > 0) {
      const instant = dChars / dt
      setTps((prev) => (prev == null ? instant : prev * 0.65 + instant * 0.35))
      s.lastLen = streamLen
      s.lastAt = now
    }
  }, [streamingId, streamLen, isRunning])

  const estContextTokens = contextPreview ? estTokensFromChars(contextPreview.estimatedChars) : null
  const ctxPct =
    estContextTokens != null && contextWindow != null && contextWindow > 0
      ? Math.min(100, (estContextTokens / contextWindow) * 100)
      : null

  const cacheHitPct = (() => {
    if (!usage) return null
    const denom = usage.input + usage.cacheRead
    if (denom <= 0) return null
    return (usage.cacheRead / denom) * 100
  })()

  return {
    contextPreview,
    estContextTokens,
    contextWindow,
    ctxPct,
    cacheHitPct,
    cacheWrite: usage?.cacheWrite ?? 0,
    tps,
    formatTokens,
  }
}