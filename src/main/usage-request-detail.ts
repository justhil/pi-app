import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type {
  UsageContextMessageItem,
  UsageMessageBlock,
  UsageRequestDetail,
} from '@shared/usage-summary'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function estimateBase64Bytes(b64: string): number {
  const len = b64.length
  if (len === 0) return 0
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((len * 3) / 4) - pad)
}

function formatByteLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** Replace inline Base64 image blobs with compact metadata so IPC & JSON trees stay fast. */
function sanitizeForJsonView(value: unknown, depth = 0): unknown {
  if (depth > 16 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJsonView(item, depth + 1))
  }
  const rec = value as Record<string, unknown>
  if (rec.type === 'image' && typeof rec.data === 'string' && rec.data.length > 256) {
    const bytes = estimateBase64Bytes(rec.data)
    return {
      ...rec,
      bytes,
      data: `[base64 omitted · ${formatByteLabel(bytes)}]`,
    }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec)) {
    out[k] = sanitizeForJsonView(v, depth + 1)
  }
  return out
}

function extractBlocks(content: unknown): UsageMessageBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []
  const blocks: UsageMessageBlock[] = []
  for (const raw of content) {
    const part = asRecord(raw)
    if (!part) continue
    if (part.type === 'text' && typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'thinking' && typeof part.thinking === 'string') {
      blocks.push({ type: 'thinking', thinking: part.thinking })
    } else if (part.type === 'toolCall' && typeof part.name === 'string') {
      blocks.push({
        type: 'toolCall',
        id: typeof part.id === 'string' ? part.id : '',
        name: part.name,
        arguments: part.arguments ?? {},
      })
    } else if (part.type === 'image') {
      const data = typeof part.data === 'string' ? part.data : ''
      blocks.push({
        type: 'image',
        mimeType: typeof part.mimeType === 'string' ? part.mimeType : 'image/*',
        bytes: estimateBase64Bytes(data),
      })
    }
  }
  return blocks
}

function summarizeBlocksText(blocks: readonly UsageMessageBlock[]): string {
  for (const b of blocks) {
    if (b.type === 'text' && b.text.trim()) {
      return b.text.replace(/\s+/g, ' ').trim().slice(0, 140)
    }
  }
  const tools = blocks.filter((b): b is Extract<UsageMessageBlock, { type: 'toolCall' }> => b.type === 'toolCall')
  if (tools.length > 0) {
    return tools.map((t) => `${t.name}(…)`).join(', ').slice(0, 140)
  }
  for (const b of blocks) {
    if (b.type === 'thinking' && b.thinking.trim()) {
      return b.thinking.replace(/\s+/g, ' ').trim().slice(0, 140)
    }
  }
  return ''
}

function plainTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const rec = asRecord(part)
      return rec?.type === 'text' && typeof rec.text === 'string' ? rec.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

async function loadSdk(sdkPath?: string | null): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  if (sdkPath) {
    const href = sdkPath.startsWith('file://') ? sdkPath : pathToFileURL(sdkPath).href
    return (await import(href)) as typeof import('@earendil-works/pi-coding-agent')
  }
  return import('@earendil-works/pi-coding-agent')
}

/**
 * Reconstructs both the exact LLM request context (via `SessionManager.buildSessionContext()` at
 * `entry.parentId`) and the assistant response directly from the existing `.jsonl` file.
 */
export async function readUsageRequestDetailFromFile(
  sessionFile: string,
  entryId: string,
  sdkPath?: string | null,
): Promise<UsageRequestDetail> {
  const raw = await readFile(sessionFile, 'utf8')
  const lines = raw.split(/\r?\n/)

  let sessionId: string | null = null
  let project = ''
  let firstUserTitle = ''
  let namedTitle = ''
  let targetEntry: Record<string, unknown> | null = null
  let targetLineIndex = -1
  let actualEntryId: string | null = null
  const parsedEntries: { lineIdx: number; entry: Record<string, unknown> }[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    parsedEntries.push({ lineIdx: i, entry: e })

    if (e.type === 'session') {
      if (typeof e.id === 'string') sessionId = e.id
      if (typeof e.cwd === 'string') project = e.cwd
      continue
    }
    if (e.type === 'session_info' && typeof e.name === 'string' && e.name.trim()) {
      namedTitle = e.name.trim()
      continue
    }
    if (e.type === 'message') {
      const m = asRecord(e.message)
      if (m?.role === 'user' && !firstUserTitle) {
        firstUserTitle = plainTextFromContent(m.content).replace(/\s+/g, ' ').trim().slice(0, 80)
      }
    }

    const rowId = typeof e.id === 'string' && e.id ? e.id : `@line:${i}`
    if (!targetEntry && (rowId === entryId || e.id === entryId)) {
      targetEntry = e
      targetLineIndex = i
      actualEntryId = typeof e.id === 'string' && e.id ? e.id : null
    }
  }

  if (!targetEntry) {
    throw new Error(`Entry ${entryId} not found in session file`)
  }

  const targetMsg = asRecord(targetEntry.message) ?? {}
  const parentId = typeof targetEntry.parentId === 'string' ? targetEntry.parentId : null

  // Collect direct child toolResult entries belonging to this assistant turn
  const toolResults: UsageRequestDetail['response']['toolResults'] = []
  if (actualEntryId) {
    const assistantToolIds = new Set<string>()
    if (Array.isArray(targetMsg.content)) {
      for (const c of targetMsg.content) {
        const rec = asRecord(c)
        if (rec?.type === 'toolCall' && typeof rec.id === 'string') assistantToolIds.add(rec.id)
      }
    }
    if (assistantToolIds.size > 0) {
      for (const { lineIdx, entry } of parsedEntries) {
        if (lineIdx <= targetLineIndex) continue
        if (entry.type !== 'message') continue
        const m = asRecord(entry.message)
        if (m?.role !== 'toolResult') continue
        const tcId = typeof m.toolCallId === 'string' ? m.toolCallId : ''
        if (!tcId || !assistantToolIds.has(tcId)) continue
        toolResults.push({
          toolCallId: tcId,
          toolName: typeof m.toolName === 'string' ? m.toolName : 'tool',
          isError: !!m.isError,
          text: plainTextFromContent(m.content).slice(0, 8000),
          ...(typeof m.durationMs === 'number' ? { durationMs: Math.round(m.durationMs) } : {}),
        })
      }
    }
  }

  // Reconstruct exact LLM request context using Pi SDK's SessionManager at `parentId`
  let contextMessages: Record<string, unknown>[] = []
  let contextModel: { provider: string; modelId: string } | null = null
  let contextThinkingLevel: string | undefined
  let rawContextObj: unknown = null

  const canBranchWithSdk =
    parentId === null || (typeof parentId === 'string' && !parentId.startsWith('@line:'))

  if (canBranchWithSdk && actualEntryId) {
    try {
      const sdk = await loadSdk(sdkPath)
      const sm = sdk.SessionManager.open(sessionFile)
      if (parentId === null) sm.resetLeaf()
      else sm.branch(parentId)
      const built = sm.buildSessionContext()
      contextMessages = (built.messages ?? []) as unknown as Record<string, unknown>[]
      contextModel = built.model ?? null
      contextThinkingLevel = built.thinkingLevel
      rawContextObj = built
    } catch {
      /* fallback below */
    }
  }

  if (contextMessages.length === 0 && targetLineIndex > 0) {
    contextMessages = parsedEntries
      .filter((p) => p.lineIdx < targetLineIndex && p.entry.type === 'message' && asRecord(p.entry.message))
      .map((p) => p.entry.message as Record<string, unknown>)
    rawContextObj = { messages: contextMessages }
  }

  // Extract cumulative system instructions / sections / declared tools from system messages
  const systemSectionMap = new Map<string, string | null>()
  const addedToolsMap = new Map<string, { name: string; description?: string }>()
  const removedToolsSet = new Set<string>()
  const conversationMessages: UsageContextMessageItem[] = []

  for (const msg of contextMessages) {
    const role = typeof msg.role === 'string' ? msg.role : 'unknown'
    if (role === 'system') {
      if (typeof msg.content === 'string' && msg.content.trim()) {
        systemSectionMap.set('system', msg.content)
      }
      const sections = asRecord(msg.sections)
      if (sections) {
        for (const [secKey, secVal] of Object.entries(sections)) {
          if (secVal === null) systemSectionMap.delete(secKey)
          else if (typeof secVal === 'string') systemSectionMap.set(secKey, secVal)
        }
      }
      if (Array.isArray(msg.toolsAdded)) {
        for (const rawTool of msg.toolsAdded) {
          const t = asRecord(rawTool)
          if (t && typeof t.name === 'string') {
            removedToolsSet.delete(t.name)
            addedToolsMap.set(t.name, {
              name: t.name,
              ...(typeof t.description === 'string' ? { description: t.description.slice(0, 200) } : {}),
            })
          }
        }
      }
      if (Array.isArray(msg.toolsRemoved)) {
        for (const name of msg.toolsRemoved) {
          if (typeof name === 'string') {
            addedToolsMap.delete(name)
            removedToolsSet.add(name)
          }
        }
      }
      continue
    }

    let blocks = extractBlocks(msg.content)
    if (blocks.length === 0 && typeof msg.summary === 'string' && msg.summary) {
      blocks = [{ type: 'text', text: msg.summary }]
    }
    conversationMessages.push({
      index: conversationMessages.length,
      role,
      ...(typeof msg.timestamp === 'number' ? { timestamp: msg.timestamp } : {}),
      ...(typeof msg.toolName === 'string' ? { toolName: msg.toolName } : {}),
      ...(typeof msg.toolCallId === 'string' ? { toolCallId: msg.toolCallId } : {}),
      ...(typeof msg.isError === 'boolean' ? { isError: msg.isError } : {}),
      summary: summarizeBlocksText(blocks),
      blocks,
    })
  }

  // Focus index: locate the last `user` message starting the current turn; fallback to last item
  let focusStartIndex = Math.max(0, conversationMessages.length - 1)
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    if (conversationMessages[i].role === 'user') {
      focusStartIndex = i
      break
    }
  }

  const diagnostics = Array.isArray(targetMsg.diagnostics)
    ? targetMsg.diagnostics
        .map((d) => asRecord(d))
        .filter((d): d is Record<string, unknown> => !!d && typeof d.message === 'string')
        .map((d) => ({
          type: typeof d.type === 'string' ? d.type : 'diagnostic',
          message: String(d.message),
        }))
    : undefined

  return {
    sessionFile,
    sessionId,
    sessionTitle: namedTitle || firstUserTitle,
    project: project || '(unknown)',
    entryId,
    parentId,
    model:
      contextModel ??
      (typeof targetMsg.provider === 'string' && typeof targetMsg.model === 'string'
        ? { provider: targetMsg.provider, modelId: targetMsg.model }
        : null),
    thinkingLevel:
      (typeof targetMsg.thinkingLevel === 'string' ? targetMsg.thinkingLevel : undefined) ??
      contextThinkingLevel,
    request: {
      totalMessages: conversationMessages.length,
      focusStartIndex,
      systemSections: [...systemSectionMap.entries()].map(([name, content]) => ({ name, content })),
      toolsDeclared: {
        added: [...addedToolsMap.values()],
        removed: [...removedToolsSet],
      },
      messages: conversationMessages,
      rawContextJson: sanitizeForJsonView(rawContextObj),
    },
    response: {
      blocks: extractBlocks(targetMsg.content),
      toolResults,
      ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
      ...(typeof targetMsg.errorMessage === 'string' && targetMsg.errorMessage
        ? { errorMessage: targetMsg.errorMessage }
        : {}),
      rawMessageJson: sanitizeForJsonView(targetEntry),
    },
  }
}
