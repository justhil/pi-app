import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  personaLanguage,
  type ActivePurgePayload,
  type PurgeStrategyOptions,
} from '@shared/agent-purge'
import { getMainUiLanguage } from '@shared/main-language'
import {
  applyHistoryPushToContext,
  applyOpenAiCompletionsTunnelPayload,
  convertPrimerTurnsToRelayCalls,
  encodeMessagesWithLexicon,
  isPolicyErrorText,
  isSentinelRelayWritePath,
  isSoftRefusalText,
  PURGE_CONTEXT_TOOL_NAME,
  PURGE_REPLY_TOOL_NAME,
  restoreLexiconText,
  restoreLexiconValueDeep,
  salvagePurgeReplyFields,
  StreamingJsonObjectFieldExtractor,
  StreamingLexiconRestorer,
  stripInlineThinkTags,
  stripOpenAiReasoningOptions,
  TOOL_OUTPUT_RELAY_SYSTEM_INSTRUCTION,
} from '@shared/purge-transforms'
import { getActiveSessionPurge } from './worker-capabilities.js'

const PREFIX_GATE_CHARS = 180
const SENTINEL_PATH_HOLD_CHARS = 220

type GenericRecord = Record<string, unknown>

export interface PurgeModelLike {
  id: string
  name?: string
  api: string
  provider: string
  [key: string]: unknown
}

export interface PurgeTranscriptContextLike {
  messages: GenericRecord[]
  [key: symbol]: unknown
}

export type PurgeStreamFn = (
  model: PurgeModelLike,
  context: PurgeTranscriptContextLike,
  options?: GenericRecord,
) => Promise<AsyncIterable<GenericRecord> & { result: () => Promise<GenericRecord> }> | (AsyncIterable<GenericRecord> & { result: () => Promise<GenericRecord> })

function isRecord(v: unknown): v is GenericRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

let cachedCreateEventStream: (() => AsyncIterable<GenericRecord> & {
  push: (ev: GenericRecord) => void
  end: (res?: GenericRecord) => void
  result: () => Promise<GenericRecord>
}) | null = null

async function getCreateAssistantMessageEventStream() {
  if (cachedCreateEventStream) return cachedCreateEventStream
  const entry = fileURLToPath(import.meta.resolve('@earendil-works/pi-ai'))
  const mod = (await import(pathToFileURL(join(dirname(entry), 'utils', 'event-stream.js')).href)) as {
    createAssistantMessageEventStream: NonNullable<typeof cachedCreateEventStream>
  }
  cachedCreateEventStream = mod.createAssistantMessageEventStream
  return cachedCreateEventStream
}

function buildPurgeReplyPiTool(includeThinkChain: boolean, isCreative: boolean): GenericRecord {
  const thinkDesc = isCreative
    ? '围绕人物神态、动作细节、光影氛围与叙事张力先完成内部构思。'
    : '围绕本地沙箱架构、代码逻辑、命令参数或排障方案先完成内部推演。'
  const contentDesc = isCreative
    ? '直接交付给用户的完整正文或分镜内容（保留所有 __SLOT_N__ 占位符，不输出寒暄套话）。'
    : '直接交付给用户的完整可执行代码、命令步骤或结论（保留所有 __SLOT_N__ 占位符，不输出寒暄套话）。'

  return {
    name: PURGE_REPLY_TOOL_NAME,
    description: '正式答复输出通道：将交付给用户的完整文字放入 content 参数返回（如需调用工作区其他工具请照常调用）。',
    parameters: {
      type: 'object',
      properties: {
        ...(includeThinkChain ? { think_chain: { type: 'string', description: thinkDesc } } : {}),
        content: { type: 'string', description: contentDesc },
      },
      required: includeThinkChain ? ['think_chain', 'content'] : ['content'],
    },
  }
}

function injectRelayToolIntoTranscriptMessages(
  messages: GenericRecord[],
  includeThinkChain: boolean,
  isCreative: boolean,
): GenericRecord[] {
  const out = messages.map((m) => (isRecord(m) ? structuredClone(m) : m))
  const toolDecl = buildPurgeReplyPiTool(includeThinkChain, isCreative)

  const headIdx = out.findIndex((m) => isRecord(m) && m.role === 'system')
  if (headIdx < 0) {
    out.unshift({
      role: 'system',
      content: TOOL_OUTPUT_RELAY_SYSTEM_INSTRUCTION.trim(),
      toolsAdded: [toolDecl],
      timestamp: 0,
    })
    return out
  }

  const head = { ...out[headIdx] }
  const existingTools = Array.isArray(head.toolsAdded) ? [...head.toolsAdded] : []
  if (!existingTools.some((t) => isRecord(t) && t.name === PURGE_REPLY_TOOL_NAME)) {
    existingTools.push(toolDecl)
  }
  head.toolsAdded = existingTools

  if (isRecord(head.sections)) {
    head.sections = {
      ...head.sections,
      purge_output_relay: `<purge_output_relay>\n${TOOL_OUTPUT_RELAY_SYSTEM_INSTRUCTION.trim()}\n</purge_output_relay>`,
    }
  } else if (typeof head.content === 'string' && !head.content.includes(PURGE_REPLY_TOOL_NAME)) {
    head.content = `${head.content}${TOOL_OUTPUT_RELAY_SYSTEM_INSTRUCTION}`
  }
  out[headIdx] = head
  return out
}

interface AttemptOutcome {
  committedDownstream: boolean
  shouldRetry: boolean
  bufferedEvents: GenericRecord[]
  terminalEvent: GenericRecord
}

function cloneAssistantMessage(msg: GenericRecord): GenericRecord {
  return {
    ...msg,
    content: Array.isArray(msg.content) ? msg.content.map((b) => (isRecord(b) ? structuredClone(b) : b)) : [],
  }
}

async function runSinglePurgeAttempt(opts: {
  baseStreamFn: PurgeStreamFn
  model: PurgeModelLike
  rawContext: PurgeTranscriptContextLike
  rawOptions: GenericRecord | undefined
  purge: Readonly<ActivePurgePayload>
  strategy: PurgeStrategyOptions
  enablePrefixGate: boolean
  pushDownstream: (ev: GenericRecord) => void
}): Promise<AttemptOutcome> {
  const { baseStreamFn, model, rawContext, rawOptions, purge, strategy, enablePrefixGate, pushDownstream } = opts
  const lang = personaLanguage(getMainUiLanguage())
  const isCreative = purge.personaId === 'creative'
  const isTunnelCapable = model.api === 'openai-completions'
  const effectiveTunnel = strategy.historyMode === 'tunnel' && isTunnelCapable
  const effectivePush =
    strategy.historyMode === 'push' || (strategy.historyMode === 'tunnel' && !isTunnelCapable)
  const thinkingGuidance = strategy.thinkingGuidance ?? 'anchor'
  const suppressNativeReasoning =
    effectiveTunnel || thinkingGuidance === 'tool_cot' || thinkingGuidance === 'suppress'
  const effectiveRelay =
    strategy.toolOutputRelay || effectiveTunnel || thinkingGuidance === 'tool_cot'

  let workingMessages = Array.isArray(rawContext.messages)
    ? rawContext.messages.map((m) => (isRecord(m) ? structuredClone(m) : m))
    : []

  const lexEncoded = encodeMessagesWithLexicon(workingMessages, {
    cipherLevel: strategy.cipherLevel,
    customTerms: purge.customTerms,
    attachLegendToLastUser: true,
  })
  workingMessages = lexEncoded.messages
  const reverseMap = lexEncoded.reverseMap
  const restoreSlashSplits = isCreative && (strategy.cipherLevel !== 'off' || effectiveRelay)

  if (effectivePush) {
    workingMessages = applyHistoryPushToContext(workingMessages, lang)
  }

  const includeThinkChain =
    effectiveTunnel ||
    thinkingGuidance === 'tool_cot' ||
    rawOptions?.reasoning === 'off' ||
    !rawOptions?.reasoning
  if (effectiveRelay && !effectiveTunnel) {
    // Convert any injected primer assistant demonstration into an authentic purge_reply call
    // so non-tunnel models (Anthropic / Gemini / Responses) reliably follow the relay channel.
    workingMessages = convertPrimerTurnsToRelayCalls(workingMessages, {
      includeThinkChain,
      isCreative,
    })
    workingMessages = injectRelayToolIntoTranscriptMessages(workingMessages, includeThinkChain, isCreative)
  }

  const nextContext: PurgeTranscriptContextLike = {
    ...rawContext,
    messages: workingMessages,
  }

  const prevOnPayload =
    typeof rawOptions?.onPayload === 'function'
      ? (rawOptions.onPayload as (payload: unknown, m: unknown) => unknown | Promise<unknown>)
      : undefined

  const needsWirePayloadHook = effectiveTunnel || (suppressNativeReasoning && isTunnelCapable)
  const nextOptions: GenericRecord = {
    ...(rawOptions ?? {}),
    ...(suppressNativeReasoning ? { reasoning: 'off' } : {}),
    ...(needsWirePayloadHook
      ? {
          onPayload: async (payload: unknown, m: unknown) => {
            const stepped = prevOnPayload ? ((await prevOnPayload(payload, m)) ?? payload) : payload
            if (effectiveTunnel) {
              return applyOpenAiCompletionsTunnelPayload(stepped, { isCreative })
            }
            return stripOpenAiReasoningOptions(stepped)
          },
        }
      : {}),
  }

  const bufferedEvents: GenericRecord[] = []
  let committedDownstream = false

  const emitOrBuffer = (ev: GenericRecord) => {
    if (committedDownstream || !enablePrefixGate) {
      committedDownstream = true
      pushDownstream(ev)
    } else {
      bufferedEvents.push(ev)
    }
  }

  const commitBufferedNow = () => {
    if (committedDownstream) return
    committedDownstream = true
    while (bufferedEvents.length > 0) {
      pushDownstream(bufferedEvents.shift()!)
    }
  }

  let basePartial: GenericRecord = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [],
    stopReason: 'stop',
    timestamp: Date.now(),
  }

  const outBlocks: GenericRecord[] = []
  let thinkOutIdx: number | null = null
  let textOutIdx: number | null = null
  let assembledThink = ''
  let assembledText = ''
  let sawStart = false

  const snapshotPartial = (): GenericRecord => ({
    ...basePartial,
    content: outBlocks.map((b) => ({ ...b })),
  })

  const ensureStarted = () => {
    if (sawStart) return
    sawStart = true
    emitOrBuffer({ type: 'start', partial: snapshotPartial() })
  }

  const appendThinkingDelta = (delta: string) => {
    if (!delta) return
    ensureStarted()
    if (thinkOutIdx === null) {
      thinkOutIdx = outBlocks.length
      outBlocks.push({ type: 'thinking', thinking: '' })
      emitOrBuffer({ type: 'thinking_start', contentIndex: thinkOutIdx, partial: snapshotPartial() })
    }
    assembledThink += delta
    outBlocks[thinkOutIdx] = { ...outBlocks[thinkOutIdx], thinking: assembledThink }
    emitOrBuffer({
      type: 'thinking_delta',
      contentIndex: thinkOutIdx,
      delta,
      partial: snapshotPartial(),
    })
  }

  const closeThinkingIfOpen = () => {
    if (thinkOutIdx === null) return
    emitOrBuffer({
      type: 'thinking_end',
      contentIndex: thinkOutIdx,
      content: assembledThink,
      partial: snapshotPartial(),
    })
  }

  const textRestorer = new StreamingLexiconRestorer(reverseMap, { restoreSlashSplits })

  const pushRestoredTextDelta = (cleanDelta: string) => {
    if (!cleanDelta) return
    ensureStarted()
    if (textOutIdx === null) {
      textOutIdx = outBlocks.length
      outBlocks.push({ type: 'text', text: '' })
      emitOrBuffer({ type: 'text_start', contentIndex: textOutIdx, partial: snapshotPartial() })
    }
    assembledText += cleanDelta
    outBlocks[textOutIdx] = { ...outBlocks[textOutIdx], text: assembledText }
    emitOrBuffer({
      type: 'text_delta',
      contentIndex: textOutIdx,
      delta: cleanDelta,
      partial: snapshotPartial(),
    })
    if (
      enablePrefixGate &&
      !committedDownstream &&
      assembledText.length >= PREFIX_GATE_CHARS &&
      !isSoftRefusalText(assembledText)
    ) {
      commitBufferedNow()
    }
  }

  const feedRawTextDelta = (rawDelta: string) => {
    const out = textRestorer.push(rawDelta)
    if (out) pushRestoredTextDelta(out)
  }

  const flushAndCloseTextIfOpen = () => {
    const tail = textRestorer.flush()
    if (tail) pushRestoredTextDelta(tail)
    if (textOutIdx !== null) {
      // Strip any stray inline <think>...</think> residue from finalized prose
      const cleanedFinal = stripInlineThinkTags(assembledText)
      if (cleanedFinal !== assembledText && cleanedFinal.length > 0) {
        assembledText = cleanedFinal
        outBlocks[textOutIdx] = { ...outBlocks[textOutIdx], text: assembledText }
      }
      emitOrBuffer({
        type: 'text_end',
        contentIndex: textOutIdx,
        content: assembledText,
        partial: snapshotPartial(),
      })
    }
  }

  interface TrackedToolSlot {
    kind: 'purge_reply' | 'context_ignore' | 'write_probe' | 'write_sentinel' | 'real_tool'
    name: string
    outIdx: number | null
    scanner?: StreamingJsonObjectFieldExtractor
    sawDeltaChars: number
    probedPath: string
    rawDeltaBuffer: string[]
    initialBlock?: GenericRecord
  }

  const toolSlots = new Map<number, TrackedToolSlot>()
  let realToolCallCount = 0

  const promoteWriteProbeToRealTool = (slot: TrackedToolSlot) => {
    slot.kind = 'real_tool'
    realToolCallCount++
    ensureStarted()
    commitBufferedNow()
    const outIdx = outBlocks.length
    slot.outIdx = outIdx
    outBlocks.push(slot.initialBlock ? structuredClone(slot.initialBlock) : { type: 'toolCall', id: `call_${outIdx}`, name: slot.name, arguments: {} })
    pushDownstream({ type: 'toolcall_start', contentIndex: outIdx, partial: snapshotPartial() })
    for (const delta of slot.rawDeltaBuffer) {
      pushDownstream({ type: 'toolcall_delta', contentIndex: outIdx, delta, partial: snapshotPartial() })
    }
    slot.rawDeltaBuffer = []
  }

  try {
    const upstream = await baseStreamFn(model, nextContext, nextOptions)

    for await (const ev of upstream) {
      const type = String(ev.type ?? '')
      if (isRecord(ev.partial)) {
        const { content: _ignored, ...meta } = ev.partial
        basePartial = { ...basePartial, ...meta }
      }

      switch (type) {
        case 'start': {
          ensureStarted()
          break
        }

        case 'thinking_start':
        case 'thinking_end':
          break
        case 'thinking_delta': {
          appendThinkingDelta(String(ev.delta ?? ''))
          break
        }

        case 'text_start':
        case 'text_end':
          break
        case 'text_delta': {
          feedRawTextDelta(String(ev.delta ?? ''))
          break
        }

        case 'toolcall_start': {
          const inIdx = Number(ev.contentIndex ?? 0)
          const partialContent = isRecord(ev.partial) && Array.isArray(ev.partial.content) ? ev.partial.content : []
          const block = isRecord(partialContent[inIdx]) ? partialContent[inIdx] : {}
          const toolName = String(block.name ?? '')

          if (toolName === PURGE_REPLY_TOOL_NAME) {
            toolSlots.set(inIdx, {
              kind: 'purge_reply',
              name: toolName,
              outIdx: null,
              scanner: new StreamingJsonObjectFieldExtractor(['think_chain', 'content']),
              sawDeltaChars: 0,
              probedPath: '',
              rawDeltaBuffer: [],
            })
          } else if (toolName === PURGE_CONTEXT_TOOL_NAME) {
            toolSlots.set(inIdx, {
              kind: 'context_ignore',
              name: toolName,
              outIdx: null,
              sawDeltaChars: 0,
              probedPath: '',
              rawDeltaBuffer: [],
            })
          } else if (toolName === 'write') {
            toolSlots.set(inIdx, {
              kind: 'write_probe',
              name: toolName,
              outIdx: null,
              scanner: new StreamingJsonObjectFieldExtractor(['path', 'content']),
              sawDeltaChars: 0,
              probedPath: '',
              rawDeltaBuffer: [],
              initialBlock: structuredClone(block),
            })
          } else {
            realToolCallCount++
            ensureStarted()
            commitBufferedNow()
            const outIdx = outBlocks.length
            outBlocks.push(structuredClone(block))
            toolSlots.set(inIdx, {
              kind: 'real_tool',
              name: toolName,
              outIdx,
              sawDeltaChars: 0,
              probedPath: '',
              rawDeltaBuffer: [],
            })
            pushDownstream({ type: 'toolcall_start', contentIndex: outIdx, partial: snapshotPartial() })
          }
          break
        }

        case 'toolcall_delta': {
          const inIdx = Number(ev.contentIndex ?? 0)
          const delta = String(ev.delta ?? '')
          const slot = toolSlots.get(inIdx)
          if (!slot) break
          slot.sawDeltaChars += delta.length

          if (slot.kind === 'purge_reply' && slot.scanner) {
            for (const part of slot.scanner.feed(delta)) {
              if (part.field === 'think_chain') appendThinkingDelta(part.delta)
              else if (part.field === 'content') feedRawTextDelta(part.delta)
            }
          } else if (slot.kind === 'write_sentinel' && slot.scanner) {
            for (const part of slot.scanner.feed(delta)) {
              if (part.field === 'content') feedRawTextDelta(part.delta)
            }
          } else if (slot.kind === 'write_probe' && slot.scanner) {
            slot.rawDeltaBuffer.push(delta)
            let pendingContent = ''
            for (const part of slot.scanner.feed(delta)) {
              if (part.field === 'path') slot.probedPath += part.delta
              else if (part.field === 'content') pendingContent += part.delta
            }
            if (isSentinelRelayWritePath(slot.probedPath)) {
              slot.kind = 'write_sentinel'
              slot.rawDeltaBuffer = []
              if (pendingContent) feedRawTextDelta(pendingContent)
            } else if (
              (slot.probedPath.length > 0 &&
                !slot.probedPath.endsWith('.txt') &&
                slot.probedPath.length > 8 &&
                !('__pi_purge_reply__.txt'.startsWith(slot.probedPath.split('/').pop() ?? ''))) ||
              slot.sawDeltaChars >= SENTINEL_PATH_HOLD_CHARS
            ) {
              promoteWriteProbeToRealTool(slot)
            }
          } else if (slot.kind === 'real_tool' && slot.outIdx !== null) {
            const partialContent = isRecord(ev.partial) && Array.isArray(ev.partial.content) ? ev.partial.content : []
            if (isRecord(partialContent[inIdx])) {
              outBlocks[slot.outIdx] = structuredClone(partialContent[inIdx])
            }
            pushDownstream({
              type: 'toolcall_delta',
              contentIndex: slot.outIdx,
              delta,
              partial: snapshotPartial(),
            })
          }
          break
        }

        case 'toolcall_end': {
          const inIdx = Number(ev.contentIndex ?? 0)
          const slot = toolSlots.get(inIdx)
          const rawTc = isRecord(ev.toolCall) ? structuredClone(ev.toolCall) : null
          if (!slot) break

          if (slot.kind === 'purge_reply') {
            if (slot.sawDeltaChars === 0 && rawTc) {
              const salvaged = salvagePurgeReplyFields(rawTc.arguments)
              if (salvaged.thinkChain) appendThinkingDelta(salvaged.thinkChain)
              if (salvaged.content) feedRawTextDelta(salvaged.content)
            }
          } else if (slot.kind === 'write_probe') {
            const pathArg = isRecord(rawTc?.arguments) ? rawTc.arguments.path : slot.probedPath
            if (isSentinelRelayWritePath(pathArg)) {
              slot.kind = 'write_sentinel'
              const contentArg = isRecord(rawTc?.arguments) ? rawTc.arguments.content : ''
              if (typeof contentArg === 'string' && contentArg && slot.sawDeltaChars === 0) {
                feedRawTextDelta(contentArg)
              }
            } else {
              promoteWriteProbeToRealTool(slot)
              if (slot.outIdx !== null && rawTc) {
                if (Object.keys(reverseMap).length > 0 || restoreSlashSplits) {
                  rawTc.arguments = restoreLexiconValueDeep(rawTc.arguments, reverseMap, {
                    restoreSlashSplits,
                  })
                }
                outBlocks[slot.outIdx] = rawTc
                pushDownstream({
                  type: 'toolcall_end',
                  contentIndex: slot.outIdx,
                  toolCall: rawTc,
                  partial: snapshotPartial(),
                })
              }
            }
          } else if (slot.kind === 'real_tool' && slot.outIdx !== null && rawTc) {
            if (Object.keys(reverseMap).length > 0 || restoreSlashSplits) {
              rawTc.arguments = restoreLexiconValueDeep(rawTc.arguments, reverseMap, {
                restoreSlashSplits,
              })
            }
            outBlocks[slot.outIdx] = rawTc
            pushDownstream({
              type: 'toolcall_end',
              contentIndex: slot.outIdx,
              toolCall: rawTc,
              partial: snapshotPartial(),
            })
          }
          break
        }

        case 'done': {
          const origMsg = isRecord(ev.message) ? cloneAssistantMessage(ev.message) : snapshotPartial()

          // Non-delta fallback: if upstream only populated toolCall blocks inside final `done.message`
          if (Array.isArray(origMsg.content)) {
            for (const block of origMsg.content) {
              if (!isRecord(block)) continue
              if (block.type === 'toolCall' && block.name === PURGE_REPLY_TOOL_NAME && !assembledText) {
                const salvaged = salvagePurgeReplyFields(block.arguments)
                if (salvaged.thinkChain && !assembledThink) appendThinkingDelta(salvaged.thinkChain)
                if (salvaged.content) feedRawTextDelta(salvaged.content)
              } else if (
                block.type === 'toolCall' &&
                block.name === 'write' &&
                isRecord(block.arguments) &&
                isSentinelRelayWritePath(block.arguments.path) &&
                typeof block.arguments.content === 'string' &&
                !assembledText
              ) {
                feedRawTextDelta(block.arguments.content)
              } else if (block.type === 'text' && typeof block.text === 'string' && !assembledText) {
                feedRawTextDelta(block.text)
              }
            }
          }

          closeThinkingIfOpen()
          flushAndCloseTextIfOpen()

          const realToolBlocks = outBlocks.filter((b) => isRecord(b) && b.type === 'toolCall')
          const finalStopReason =
            realToolBlocks.length > 0
              ? 'toolUse'
              : ev.reason === 'deferred'
                ? 'deferred'
                : 'stop'

          const finalMsg: GenericRecord = {
            ...origMsg,
            content: outBlocks.map((b) => ({ ...b })),
            stopReason: finalStopReason,
          }
          delete finalMsg.errorMessage

          const isEmptyReply = realToolBlocks.length === 0 && !assembledText.trim()
          const isRefusedReply =
            realToolBlocks.length === 0 && Boolean(assembledText.trim()) && isSoftRefusalText(assembledText)

          const shouldRetry =
            enablePrefixGate &&
            !committedDownstream &&
            (isEmptyReply || isRefusedReply)

          return {
            committedDownstream,
            shouldRetry,
            bufferedEvents,
            terminalEvent: {
              type: 'done',
              reason: finalStopReason,
              message: finalMsg,
            },
          }
        }

        case 'error': {
          closeThinkingIfOpen()
          flushAndCloseTextIfOpen()
          const errObj = isRecord(ev.error) ? cloneAssistantMessage(ev.error) : snapshotPartial()
          const errText = String(errObj.errorMessage ?? '')
          const aborted = ev.reason === 'aborted' || (rawOptions?.signal as AbortSignal | undefined)?.aborted
          const shouldRetry =
            enablePrefixGate &&
            !committedDownstream &&
            !aborted &&
            isPolicyErrorText(errText)

          return {
            committedDownstream,
            shouldRetry,
            bufferedEvents,
            terminalEvent: {
              type: 'error',
              reason: aborted ? 'aborted' : 'error',
              error: errObj,
            },
          }
        }
      }
    }

    // Stream ended without explicit done/error
    closeThinkingIfOpen()
    flushAndCloseTextIfOpen()
    const realToolBlocks = outBlocks.filter((b) => isRecord(b) && b.type === 'toolCall')
    const finalReason = realToolBlocks.length > 0 ? 'toolUse' : 'stop'
    const finalMsg: GenericRecord = {
      ...snapshotPartial(),
      stopReason: finalReason,
    }
    const shouldRetry =
      enablePrefixGate &&
      !committedDownstream &&
      realToolBlocks.length === 0 &&
      (!assembledText.trim() || isSoftRefusalText(assembledText))

    return {
      committedDownstream,
      shouldRetry,
      bufferedEvents,
      terminalEvent: {
        type: 'done',
        reason: finalReason,
        message: finalMsg,
      },
    }
  } catch (thrown: unknown) {
    const aborted = Boolean((rawOptions?.signal as AbortSignal | undefined)?.aborted)
    const errText = thrown instanceof Error ? thrown.message : String(thrown)
    const shouldRetry =
      enablePrefixGate &&
      !committedDownstream &&
      !aborted &&
      isPolicyErrorText(errText)

    const errorMessageObj: GenericRecord = {
      ...basePartial,
      content: outBlocks.length > 0 ? outBlocks.map((b) => ({ ...b })) : [],
      stopReason: aborted ? 'aborted' : 'error',
      errorMessage: restoreLexiconText(errText, reverseMap, { restoreSlashSplits }),
      timestamp: Date.now(),
    }
    return {
      committedDownstream,
      shouldRetry,
      bufferedEvents,
      terminalEvent: {
        type: 'error',
        reason: aborted ? 'aborted' : 'error',
        error: errorMessageObj,
      },
    }
  }
}

/**
 * Escalate strategy for the single fallback retry using ONLY lossless structural channels:
 * - Never auto-enables `cipherLevel` when the user has it set to `'off'` (avoids silent semantic drift).
 * - Upgrades `historyMode` to `'tunnel'` (on `openai-completions`) or `'push'` + `toolOutputRelay: true`.
 */
export function buildEscalatedRetryStrategy(
  primary: PurgeStrategyOptions,
  modelApi: string,
): PurgeStrategyOptions {
  return {
    ...primary,
    scrubHistory: true,
    thinkingGuidance: 'tool_cot',
    historyMode: modelApi === 'openai-completions' ? 'tunnel' : 'push',
    toolOutputRelay: true,
    // Strictly preserve user's chosen cipherLevel — never silently enable keyword substitution
    cipherLevel: primary.cipherLevel,
    autoRetry: false,
  }
}

export function createPurgeStreamWrapper(
  baseStreamFn: PurgeStreamFn,
  resolveFallbackModel?: (spec: string) => Promise<{ model: PurgeModelLike; apiKey?: string } | null>,
): PurgeStreamFn {
  return async (model, context, options) => {
    const purge = getActiveSessionPurge()
    if (!purge) {
      return baseStreamFn(model, context, options)
    }

    const s = purge.strategy
    const needsWrapper =
      s.historyMode !== 'none' ||
      s.toolOutputRelay ||
      s.thinkingGuidance === 'tool_cot' ||
      s.thinkingGuidance === 'suppress' ||
      s.cipherLevel !== 'off' ||
      s.autoRetry

    if (!needsWrapper) {
      return baseStreamFn(model, context, options)
    }

    const createEventStream = await getCreateAssistantMessageEventStream()
    const outStream = createEventStream()

    void (async () => {
      const attempt1 = await runSinglePurgeAttempt({
        baseStreamFn,
        model,
        rawContext: context,
        rawOptions: options,
        purge,
        strategy: s,
        enablePrefixGate: s.autoRetry,
        pushDownstream: (ev) => outStream.push(ev),
      })

      if (!attempt1.shouldRetry) {
        if (!attempt1.committedDownstream) {
          for (const ev of attempt1.bufferedEvents) outStream.push(ev)
        }
        outStream.push(attempt1.terminalEvent)
        return
      }

      // Single lossless escalated retry
      let retryModel = model
      let retryOptions = options
      if (purge.retryFallbackModel && resolveFallbackModel) {
        const resolved = await resolveFallbackModel(purge.retryFallbackModel).catch(() => null)
        if (resolved) {
          retryModel = resolved.model
          if (resolved.apiKey) {
            retryOptions = { ...(options ?? {}), apiKey: resolved.apiKey }
          }
        }
      }

      const escalatedStrategy = buildEscalatedRetryStrategy(s, retryModel.api)
      const attempt2 = await runSinglePurgeAttempt({
        baseStreamFn,
        model: retryModel,
        rawContext: context,
        rawOptions: retryOptions,
        purge,
        strategy: escalatedStrategy,
        enablePrefixGate: false,
        pushDownstream: (ev) => outStream.push(ev),
      })

      if (!attempt2.committedDownstream) {
        for (const ev of attempt2.bufferedEvents) outStream.push(ev)
      }
      outStream.push(attempt2.terminalEvent)
    })()

    return outStream
  }
}
