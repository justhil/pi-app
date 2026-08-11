import { extractTextFromPiMessage, type PiSessionMessage } from './worker-message'

export type SessionContextSegment = {
  index: number
  role: string
  chars: number
  preview: string
  label?: string
}

export type SessionContextRoleSlice = {
  role: string
  chars: number
}

export type SessionContextPreview = {
  sessionId: string | null
  sessionFile: string
  messageCount: number
  estimatedChars: number
  snippets: string[]
  segments: SessionContextSegment[]
  roleBreakdown: SessionContextRoleSlice[]
}

type BuildPreviewInput = {
  sessionId?: string | null
  sessionFile: string
  messages?: readonly PiSessionMessage[] | null
}

function roleBucket(role: string): string {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  if (role === 'toolResult' || role === 'tool') return 'tool'
  if (role === 'system') return 'system'
  if (role === 'compactionSummary' || role === 'branchSummary') return 'summary'
  return 'other'
}

function messageLabel(message: PiSessionMessage): string | undefined {
  if (message.role === 'toolResult' && message.toolName) return message.toolName
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return undefined
  const tools = message.content
    .filter((content) => content.type === 'toolCall')
    .map((content) => (content as { toolCall?: { name?: string } }).toolCall?.name)
    .filter((name): name is string => !!name)
  return tools.length > 0 ? tools.join(', ') : undefined
}

export function buildSessionContextPreview(input: BuildPreviewInput): SessionContextPreview {
  const snippets: string[] = []
  const segments: SessionContextSegment[] = []
  const roleChars: Record<string, number> = {}
  let estimatedChars = 0

  const append = (role: string, text: string, label?: string): void => {
    const chars = text.length
    estimatedChars += chars
    if (chars > 0) {
      const bucket = roleBucket(role)
      roleChars[bucket] = (roleChars[bucket] || 0) + chars
    }
    segments.push({
      index: segments.length,
      role,
      chars,
      preview: text.slice(0, 280),
      label,
    })
  }

  const messages = input.messages || []
  for (const message of messages) {
    const role = message.role || '?'
    const text = extractTextFromPiMessage(message)
    append(role, text, messageLabel(message))
    if (snippets.length < 12 && text) {
      snippets.push(`[${role}] ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`)
    }
  }

  const roleOrder = ['system', 'user', 'assistant', 'tool', 'summary', 'other']
  const roleBreakdown = roleOrder
    .filter((role) => (roleChars[role] || 0) > 0)
    .map((role) => ({ role, chars: roleChars[role] || 0 }))

  return {
    sessionId: input.sessionId || null,
    sessionFile: input.sessionFile,
    messageCount: messages.length,
    estimatedChars,
    snippets,
    segments,
    roleBreakdown,
  }
}
