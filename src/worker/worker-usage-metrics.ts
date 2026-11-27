import type { ExtensionFactory, InlineExtension } from '@earendil-works/pi-coding-agent'

export type FirstTokenKind = 'thinking' | 'text' | 'toolCall'

type ClockDeps = {
  nowMono?: () => number
  nowWall?: () => number
}

function classifyFirstToken(evt: unknown): FirstTokenKind | null {
  if (!evt || typeof evt !== 'object') return null
  const rec = evt as { type?: unknown; delta?: unknown }
  const t = typeof rec.type === 'string' ? rec.type : ''
  if (t === 'thinking_delta') {
    return typeof rec.delta === 'string' && rec.delta.length === 0 ? null : 'thinking'
  }
  if (t === 'text_delta') {
    return typeof rec.delta === 'string' && rec.delta.length === 0 ? null : 'text'
  }
  if (t === 'toolcall_start' || t === 'toolcall_delta') {
    return 'toolCall'
  }
  return null
}

/**
 * Stamps monotonic `ttftMs` and `firstTokenKind` onto each streamed `AssistantMessage`
 * right before `SessionManager.appendMessage(event.message)` writes the `.jsonl` entry.
 * Zero extra files or sidecar logs are created.
 */
export function createUsageMetricsExtension(deps?: ClockDeps): {
  name: string
  builtin: boolean
  hidden: boolean
  factory: ExtensionFactory
} {
  const nowMono = deps?.nowMono ?? (() => performance.now())
  const nowWall = deps?.nowWall ?? (() => Date.now())

  return {
    name: 'pi-desktop-usage-metrics',
    builtin: true,
    hidden: true,
    factory: (pi) => {
      let pendingDispatchMono: number | null = null
      let activeStartMono: number | null = null
      let capturedTtftMs: number | null = null
      let capturedKind: FirstTokenKind | null = null

      const markDispatchBoundary = () => {
        pendingDispatchMono = nowMono()
      }

      pi.on('turn_start', async () => {
        markDispatchBoundary()
      })

      pi.on('message_start', async (event) => {
        const msg = event.message as { role?: string; timestamp?: number } | undefined
        if (msg?.role !== 'assistant') return
        if (pendingDispatchMono !== null) {
          activeStartMono = pendingDispatchMono
          pendingDispatchMono = null
        } else {
          const streamMono = nowMono()
          if (typeof msg.timestamp === 'number') {
            const wallElapsed = Math.max(0, nowWall() - msg.timestamp)
            activeStartMono = streamMono - wallElapsed
          } else {
            activeStartMono = streamMono
          }
        }
        capturedTtftMs = null
        capturedKind = null
      })

      pi.on('message_update', async (event) => {
        if (capturedTtftMs !== null || activeStartMono === null) return
        const kind = classifyFirstToken(
          (event as { assistantMessageEvent?: unknown }).assistantMessageEvent,
        )
        if (!kind) return
        capturedTtftMs = Math.max(0, Math.round(nowMono() - activeStartMono))
        capturedKind = kind
      })

      pi.on('message_end', async (event) => {
        const msg = event.message as Record<string, unknown> | undefined
        if (!msg) return
        if (msg.role !== 'assistant') {
          // User prompt or toolResult just finished; the next LLM request is about to fire.
          markDispatchBoundary()
          return
        }
        if (capturedTtftMs !== null && capturedKind !== null) {
          const dur = typeof msg.durationMs === 'number' && msg.durationMs >= 0 ? msg.durationMs : null
          msg.ttftMs = dur !== null ? Math.min(capturedTtftMs, Math.round(dur)) : capturedTtftMs
          msg.firstTokenKind = capturedKind
        }
        activeStartMono = null
        capturedTtftMs = null
        capturedKind = null
      })

      pi.on('agent_end', async () => {
        pendingDispatchMono = null
        activeStartMono = null
        capturedTtftMs = null
        capturedKind = null
      })
    },
  }
}

export const usageMetricsExtension: InlineExtension = createUsageMetricsExtension()
