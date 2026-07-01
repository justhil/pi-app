import { useUIStore } from '@renderer/stores/ui-store'

let optSeq = 0

export type OptimisticSendOpts = {
  /** 仅冷启动/首条绑定 Worker 时为 true，同会话后续消息应 false（显示「等待回复」） */
  bootstrap?: boolean
}

/** 发送后立即在 Timeline 展示用户消息 + 助手等待占位 */
export function appendOptimisticOutgoingMessage(text: string, opts?: OptimisticSendOpts): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const store = useUIStore.getState()
  const ts = Date.now()
  const userId = `opt-user-${++optSeq}`
  const assistantId = `opt-asst-${optSeq}`

  store.appendTimeline({
    id: userId,
    type: 'user-message',
    text: trimmed,
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
    optimisticPendingUserText: trimmed,
    agentTurnBootstrapping: opts?.bootstrap === true,
    streamingAssistantId: assistantId,
  })
  if (store.runState.status !== 'running') {
    store.setRunState({ status: 'running', startTime: ts })
  }
}

export function clearOptimisticOutgoing(): void {
  const store = useUIStore.getState()
  if (!store.optimisticPendingUserText && !store.agentTurnBootstrapping) return
  useUIStore.setState({ optimisticPendingUserText: null, agentTurnBootstrapping: false })
}