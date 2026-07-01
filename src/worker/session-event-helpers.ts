import type { AppEvent } from '@shared/app-events'
import { extractTextFromPiMessage, type PiSessionMessage } from '@shared/worker-message'

export function lastAssistantFromMessages(messages: unknown[]): { stopReason?: string } | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string }
    if (m?.role === 'assistant') return m as { stopReason?: string }
  }
  return undefined
}

export function emitAgentErrorFromAssistant(
  base: Record<string, unknown>,
  msg: PiSessionMessage & { errorMessage?: string },
  emit: (event: AppEvent) => void,
): void {
  const stop = msg?.stopReason as string | undefined
  if (stop !== 'error' && stop !== 'aborted') return
  const raw =
    (typeof msg?.errorMessage === 'string' && msg.errorMessage.trim()) ||
    extractTextFromPiMessage(msg) ||
    (stop === 'aborted' ? 'Request was aborted.' : 'Unknown error')
  emit({
    ...base,
    type: 'agent_error',
    text: String(raw),
    kind: stop === 'aborted' ? 'aborted' : 'error',
    stopReason: stop,
  } as AppEvent)
}