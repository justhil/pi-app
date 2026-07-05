/** Narrow shapes for Pi SDK session messages at the Worker → AppEvent boundary. */

export type PiTextBlock = { type: 'text'; text?: string }
export type PiThinkingBlock = { type: 'thinking'; thinking?: string }
export type PiToolResultBlock = {
  type: 'toolResult'
  content?: string | Array<{ text?: string }>
}
export type PiContentBlock = PiTextBlock | PiToolResultBlock | { type: string; text?: string }

export type PiSessionMessage = {
  role?: string
  content?: string | PiContentBlock[]
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    cost?: { total?: number }
  }
  stopReason?: string
  timestamp?: string | number
  toolName?: string
}

export type PiCompactionEndResult = {
  tokensBefore?: number
  summary?: string
}

export function piMessageTimestamp(m: PiSessionMessage | undefined, fallbackMs: number): number {
  if (!m?.timestamp) return fallbackMs
  const t = new Date(m.timestamp).getTime()
  return Number.isFinite(t) ? t : fallbackMs
}

export function extractTextFromPiMessage(message: PiSessionMessage | string | null | undefined): string {
  if (!message) return ''
  if (typeof message === 'string') return message
  if (!message.content) return ''
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((c): c is PiTextBlock => c.type === 'text')
    .map((c) => c.text || '')
    .join('')
}

/** 对齐 pi-tui AssistantMessageComponent：按 content 顺序拼接 thinking 块 */
export function extractThinkingFromPiMessage(message: PiSessionMessage | string | null | undefined): string {
  if (!message || typeof message === 'string') return ''
  if (!message.content || typeof message.content === 'string') return ''
  return message.content
    .filter((c): c is PiThinkingBlock => c.type === 'thinking')
    .map((c) => c.thinking || '')
    .join('')
}

export function extractToolResultFromPiMessage(message: PiSessionMessage | null | undefined): string {
  if (!message?.content || typeof message.content === 'string') return ''
  const parts = message.content
    .filter((c): c is PiToolResultBlock => c.type === 'toolResult')
    .map((c) => {
      if (typeof c.content === 'string') return c.content
      if (Array.isArray(c.content)) return c.content.map((x) => x.text || '').join('')
      return ''
    })
  return parts.join('\n')
}

export function piUsageTotals(usage: PiSessionMessage['usage']): {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
} | null {
  if (!usage) return null
  return {
    input: usage.input || 0,
    output: usage.output || 0,
    cacheRead: usage.cacheRead || 0,
    cacheWrite: usage.cacheWrite || 0,
    cost: usage.cost?.total || 0,
  }
}