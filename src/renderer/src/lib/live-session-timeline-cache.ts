import { mergeLiveCacheTimelineSnapshots } from '@renderer/lib/streaming-timeline-preserve'
import { mergeStreamChunk } from '@renderer/stores/ui-store-stream'
import type { AppEvent } from '@shared/app-events'
import type { RunState, TimelineItem } from '@renderer/stores/ui-store-types'

export type LiveSessionTimelineSnapshot = {
  sessionId: string | null
  sessionFile: string
  timelineItems: TimelineItem[]
  streamingAssistantId: string | null
  runState: RunState
  pendingSteering: string[]
  pendingFollowUp: string[]
  optimisticPendingUserText: string | null
  agentTurnBootstrapping: boolean
}

const liveTimelines = new Map<string, LiveSessionTimelineSnapshot>()
let seq = 0

function cloneItems(items: TimelineItem[]): TimelineItem[] {
  return items.map((i) => ({ ...i }))
}

export function saveLiveSessionTimeline(snapshot: LiveSessionTimelineSnapshot): void {
  const prev = liveTimelines.get(snapshot.sessionFile)
  const timelineItems = mergeLiveCacheTimelineSnapshots(
    snapshot.timelineItems,
    prev?.timelineItems ?? [],
  )
  liveTimelines.set(snapshot.sessionFile, {
    ...snapshot,
    timelineItems,
    streamingAssistantId: snapshot.streamingAssistantId ?? prev?.streamingAssistantId ?? null,
    pendingSteering: [...snapshot.pendingSteering],
    pendingFollowUp: [...snapshot.pendingFollowUp],
  })
}

export function getLiveSessionTimeline(sessionFile: string): LiveSessionTimelineSnapshot | null {
  const snap = liveTimelines.get(sessionFile)
  if (!snap) return null
  return {
    ...snap,
    timelineItems: cloneItems(snap.timelineItems),
    pendingSteering: [...snap.pendingSteering],
    pendingFollowUp: [...snap.pendingFollowUp],
  }
}

export function clearLiveSessionTimeline(sessionFile?: string | null): void {
  if (sessionFile) liveTimelines.delete(sessionFile)
}

function nextCachedItemId(): string {
  return `cached-live-${++seq}`
}

function ensureStreamingAssistant(snap: LiveSessionTimelineSnapshot, event: Extract<AppEvent, { type: 'message' }>): string {
  if (snap.streamingAssistantId) return snap.streamingAssistantId
  const id = nextCachedItemId()
  snap.timelineItems.push({
    id,
    type: 'assistant-message',
    text: '',
    thinkingText: '',
    runId: event.runId,
    timestamp: event.timestamp,
  })
  snap.streamingAssistantId = id
  return id
}

function applyMessage(snap: LiveSessionTimelineSnapshot, event: Extract<AppEvent, { type: 'message' }>): void {
  if (event.role === 'assistant') {
    if (event.phase === 'start') {
      ensureStreamingAssistant(snap, event)
      snap.agentTurnBootstrapping = false
      return
    }
    if (event.phase === 'delta' && event.text) {
      const id = ensureStreamingAssistant(snap, event)
      snap.agentTurnBootstrapping = false
      snap.timelineItems = snap.timelineItems.map((i) => {
        if (i.id !== id) return i
        if (event.contentKind === 'thinking') {
          return { ...i, thinkingText: mergeStreamChunk(i.thinkingText || '', event.text || '') }
        }
        return { ...i, text: mergeStreamChunk(i.text || '', event.text || '') }
      })
      return
    }
    if (event.phase === 'end') {
      const id = snap.streamingAssistantId
      snap.streamingAssistantId = null
      if (id) {
        snap.timelineItems = snap.timelineItems.map((i) => {
          if (i.id !== id) return i
          return {
            ...i,
            text: event.text && event.text.trim() ? event.text : i.text,
            ...(event.sessionEntryId ? { sessionEntryId: event.sessionEntryId } : {}),
          }
        })
      }
      return
    }
  }

  if (event.role === 'user' && event.phase === 'end' && event.sessionEntryId) {
    for (let i = snap.timelineItems.length - 1; i >= 0; i--) {
      const item = snap.timelineItems[i]
      if (item.type === 'user-message' && !item.sessionEntryId) {
        snap.timelineItems[i] = { ...item, sessionEntryId: event.sessionEntryId }
        break
      }
    }
  }
}

function applyTool(snap: LiveSessionTimelineSnapshot, event: Extract<AppEvent, { type: 'tool' }>): void {
  if (event.phase === 'start') {
    snap.streamingAssistantId = null
    snap.timelineItems.push({
      id: nextCachedItemId(),
      type: 'tool-call',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      toolPhase: 'start',
      toolArgs: event.input,
      runId: event.runId,
      timestamp: event.timestamp,
    })
    snap.runState = { ...snap.runState, activeTool: event.toolName }
    return
  }
  const idx = [...snap.timelineItems]
    .reverse()
    .findIndex((i) => i.type === 'tool-call' && i.toolCallId === event.toolCallId)
  if (idx < 0) return
  const realIdx = snap.timelineItems.length - 1 - idx
  const item = snap.timelineItems[realIdx]
  if (event.phase === 'end') {
    snap.timelineItems[realIdx] = {
      ...item,
      toolPhase: 'end',
      toolOutput: typeof event.output === 'string' ? event.output : event.output == null ? '' : JSON.stringify(event.output, null, 2),
      toolDetails: event.details,
      isError: event.isError,
    }
    snap.runState = {
      ...snap.runState,
      toolCount: snap.runState.toolCount + 1,
      errorCount: snap.runState.errorCount + (event.isError ? 1 : 0),
      activeTool: undefined,
      activeToolStatus: undefined,
    }
  }
}

function ensureLiveTimeline(sessionFile: string): LiveSessionTimelineSnapshot {
  let snap = liveTimelines.get(sessionFile)
  if (!snap) {
    snap = {
      sessionId: null,
      sessionFile,
      timelineItems: [],
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    }
    liveTimelines.set(sessionFile, snap)
  }
  return snap
}

export function applyBackgroundAppEventToLiveTimeline(sessionFile: string, event: AppEvent): void {
  const snap = ensureLiveTimeline(sessionFile)
  if (event.type === 'message') applyMessage(snap, event)
  else if (event.type === 'tool') applyTool(snap, event)
  else if (event.type === 'queue') {
    snap.pendingSteering = [...event.steering]
    snap.pendingFollowUp = [...event.followUp]
  } else if (event.type === 'agent_error') {
    snap.streamingAssistantId = null
    snap.agentTurnBootstrapping = false
    snap.runState = { ...snap.runState, status: event.kind === 'aborted' ? 'idle' : 'failed' }
  } else if (event.type === 'run') {
    if (event.phase === 'running' || event.phase === 'started') {
      snap.runState = { ...snap.runState, status: 'running', activeRunId: event.runId, startTime: event.timestamp }
    } else if (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled') {
      snap.runState = {
        ...snap.runState,
        status: event.phase === 'failed' ? 'failed' : 'idle',
        activeRunId: undefined,
        activeTool: undefined,
        activeToolStatus: undefined,
      }
    }
  }
}
