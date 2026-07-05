import type { PiSessionMessage } from './worker-message.ts'
import { extractTextFromPiMessage, extractThinkingFromPiMessage } from './worker-message.ts'

export type PiAssistantMessageEventLike = {
  type?: string
  delta?: string
  content?: string
  text?: string
}

export type AssistantStreamDelta = {
  text?: string
  thinking?: string
}

/**
 * Map pi `message_update` to cumulative assistant snapshots (pi-tui uses event.message partial).
 * Prefer partial message text/thinking; fall back to text_delta / text_end protocol events.
 */
export function assistantStreamDeltaFromMessageUpdate(
  message: PiSessionMessage | undefined,
  assistantMessageEvent: PiAssistantMessageEventLike | undefined,
): AssistantStreamDelta {
  const out: AssistantStreamDelta = {}
  const ame = assistantMessageEvent

  if (message?.role === 'assistant') {
    const text = extractTextFromPiMessage(message)
    const thinking = extractThinkingFromPiMessage(message)
    if (text) out.text = text
    if (thinking) out.thinking = thinking
  }

  if (!out.text && ame) {
    if (ame.type === 'text_delta' && typeof ame.delta === 'string' && ame.delta) {
      out.text = ame.delta
    } else if (ame.type === 'text_end' && typeof ame.content === 'string' && ame.content) {
      out.text = ame.content
    } else if (typeof ame.delta === 'string' && ame.delta) {
      out.text = ame.delta
    }
  }

  if (!out.thinking && ame) {
    if (ame.type === 'thinking_delta' && typeof ame.delta === 'string' && ame.delta) {
      out.thinking = ame.delta
    } else if (ame.type === 'thinking_end' && typeof ame.content === 'string' && ame.content) {
      out.thinking = ame.content
    }
  }

  return out
}