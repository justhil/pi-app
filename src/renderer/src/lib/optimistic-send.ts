import { useUIStore } from '@renderer/stores/ui-store'
import { clearAbortQueueIgnore, clearAbortUiHold } from '@renderer/lib/abort-ui-hold'
import { patchSessionState } from '@renderer/stores/session-scope'
import { sessionKeyOf } from '@renderer/stores/session-state'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { requestTimelineBottomAnchor } from '@renderer/features/timeline/timeline-bottom-anchor'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

let optSeq = 0

export type OptimisticSendOpts = {
  /** 仅冷启动/首条绑定 Worker 时为 true，同会话后续消息应 false（显示「等待回复」） */
  bootstrap?: boolean
  /** 文件附件元数据（旧字段，兼容） */
  attachments?: { path: string; name: string; kind: string }[]
  /** 文中分段（文本+附件位置），时间线按此渲染 */
  segments?: TimelineItem['segments']
  /** 实际提交给 Worker 的 payload 文本（含附件路径/@line-ref），用于匹配 Worker echo */
  payloadText?: string
}

export type OptimisticSendToken = {
  sessionFile: string | null
  assistantId: string
  userId: string
}

function markOptimisticSessionRunning(sessionFile: string): void {
  clearAbortUiHold(sessionFile)
  clearAbortQueueIgnore(sessionFile)
  useUIStore.getState().setSessionRuntimeRunning(sessionFile, true)
}

export function bindOptimisticOutgoingToSession(
  token: OptimisticSendToken | null,
  sessionFile: string | null,
): void {
  if (!token || !sessionFile) return
  token.sessionFile = sessionFile
  markOptimisticSessionRunning(sessionFile)
}

/** 发送后立即在 Timeline 展示用户消息 + 助手等待占位 */
export function appendOptimisticOutgoingMessage(
  text: string,
  opts?: OptimisticSendOpts,
): OptimisticSendToken | null {
  const trimmed = text.trim()
  const payloadTrimmed = opts?.payloadText?.trim() || ''
  const hasAttachments = !!(opts?.attachments?.length || opts?.segments?.length)
  if (!trimmed && !hasAttachments && !payloadTrimmed) return null
  const store = useUIStore.getState()
  const ts = Date.now()
  const userId = `opt-user-${++optSeq}`
  const assistantId = `opt-asst-${optSeq}`
  const pendingMarker = payloadTrimmed || trimmed || '[attachment]'

  store.appendTimeline({
    id: userId,
    type: 'user-message',
    text: trimmed,
    ...(payloadTrimmed && payloadTrimmed !== trimmed ? { payloadText: payloadTrimmed } : {}),
    attachments: opts?.attachments,
    segments: opts?.segments,
    timestamp: ts,
  })
  store.appendTimeline({
    id: assistantId,
    type: 'assistant-message',
    text: '',
    thinkingText: '',
    timestamp: ts + 1,
  })
  useUIStore.setState({
    optimisticPendingUserText: pendingMarker,
    // Always show optimistic thinking wait chrome until first token / tool / idle.
    agentTurnBootstrapping: true,
    // First-message flows switch this to 'starting' while they create the session.
    pendingTurnStage: 'sending',
    streamingAssistantId: assistantId,
  })
  // Mark this session running immediately so switch-away/back keeps chrome/sidebar alive
  // before the first worker `run` event arrives.
  // The rows above already live in this session's own state.
  if (store.historySessionFile) markOptimisticSessionRunning(store.historySessionFile)
  requestTimelineBottomAnchor('message-sent')
  if (store.runState.status !== 'running') {
    store.setRunState({ status: 'running', startTime: ts })
  }
  return { sessionFile: store.historySessionFile, assistantId, userId }
}

function removeOptimisticTurn(items: TimelineItem[], assistantId: string): TimelineItem[] {
  const assistantIndex = items.findIndex((item) => item.id === assistantId)
  if (assistantIndex < 0) return items
  const userIndex =
    assistantIndex > 0 && items[assistantIndex - 1]?.id.startsWith('opt-user-')
      ? assistantIndex - 1
      : assistantIndex
  return items.filter((_, index) => index < userIndex || index > assistantIndex)
}

/** Drop the failed send from the session it was made in, even after the view left it. */
function clearOptimisticSessionState(token: OptimisticSendToken): void {
  if (!token.sessionFile) return
  const key = sessionKeyOf(token.sessionFile)
  const entry = key ? useUIStore.getState().sessionStates[key] : undefined
  if (!entry) return
  patchSessionState(key, {
    timelineItems: removeOptimisticTurn(entry.timelineItems, token.assistantId),
    streamingAssistantId: entry.streamingAssistantId === token.assistantId ? null : entry.streamingAssistantId,
    runState: { ...entry.runState, status: 'idle' },
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
  })
}

export function clearOptimisticOutgoing(token: OptimisticSendToken | null): boolean {
  if (!token) return false
  const store = useUIStore.getState()
  const ownsAssistant = store.streamingAssistantId === token.assistantId
  const sameView = token.sessionFile
    ? sessionFilesEqual(store.historySessionFile, token.sessionFile)
    : ownsAssistant
  const ownsVisibleTurn = sameView && ownsAssistant
  const targetFile = token.sessionFile ?? (ownsVisibleTurn ? store.historySessionFile : null)

  if (targetFile && (!sameView || ownsVisibleTurn)) {
    store.setSessionRuntimeRunning(targetFile, false)
  }
  clearOptimisticSessionState(token)
  if (!ownsVisibleTurn) return false

  useUIStore.setState((state) => ({
    timelineItems: removeOptimisticTurn(state.timelineItems, token.assistantId),
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    streamingAssistantId: null,
  }))
  return true
}
