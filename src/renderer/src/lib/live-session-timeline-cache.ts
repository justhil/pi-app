import { mergeLiveCacheTimelineSnapshots } from '@renderer/lib/streaming-timeline-preserve'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
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
/** Cap live items for non-foreground sessions (M1). */
export const BACKGROUND_LIVE_TIMELINE_MAX_ITEMS = 200
let seq = 0

function cacheKey(sessionFile: string): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

function cloneItems(items: TimelineItem[]): TimelineItem[] {
  return items.map((i) => ({ ...i }))
}

export function saveLiveSessionTimeline(snapshot: LiveSessionTimelineSnapshot): void {
  const key = cacheKey(snapshot.sessionFile)
  if (!key) return
  const prev = liveTimelines.get(key)
  const timelineItems = mergeLiveCacheTimelineSnapshots(
    snapshot.timelineItems,
    prev?.timelineItems ?? [],
  )
  // Prefer explicit snapshot id; only fall back to prev when snapshot omitted streaming (undefined).
  // Do NOT use `??` alone on null — idle captures intentionally clear streamingAssistantId to null.
  const nextStreamingId =
    snapshot.streamingAssistantId !== undefined
      ? snapshot.streamingAssistantId
      : (prev?.streamingAssistantId ?? null)
  liveTimelines.set(key, {
    ...snapshot,
    sessionFile: key,
    timelineItems,
    streamingAssistantId: nextStreamingId,
    pendingSteering: [...snapshot.pendingSteering],
    pendingFollowUp: [...snapshot.pendingFollowUp],
  })
}

export function getLiveSessionTimeline(sessionFile: string): LiveSessionTimelineSnapshot | null {
  const key = cacheKey(sessionFile)
  if (!key) return null
  flushBackgroundLiveDeltasSync(key)
  const snap = liveTimelines.get(key)
  if (!snap) return null
  return {
    ...snap,
    timelineItems: cloneItems(snap.timelineItems),
    pendingSteering: [...snap.pendingSteering],
    pendingFollowUp: [...snap.pendingFollowUp],
  }
}

export function clearLiveSessionTimeline(sessionFile?: string | null): void {
  if (sessionFile) {
    const key = cacheKey(sessionFile)
    if (key) {
      backgroundDeltaPending.delete(key)
      liveTimelines.delete(key)
    }
    return
  }
  backgroundDeltaPending.clear()
  liveTimelines.clear()
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

type PendingBgDelta = { text: string; thinking: string }
const backgroundDeltaPending = new Map<string, PendingBgDelta>()
let backgroundDeltaFlushScheduled = false

function applyAssistantDeltaToSnap(
  snap: LiveSessionTimelineSnapshot,
  assistantId: string,
  textDelta: string,
  thinkingDelta: string,
): void {
  const index = snap.timelineItems.findIndex((row) => row.id === assistantId)
  if (index < 0) return
  const current = snap.timelineItems[index]
  let nextText = current.text || ''
  let nextThinking = current.thinkingText || ''
  let changed = false
  if (textDelta) {
    const merged = mergeStreamChunk(nextText, textDelta)
    if (merged !== nextText) {
      nextText = merged
      changed = true
    }
  }
  if (thinkingDelta) {
    const merged = mergeStreamChunk(nextThinking, thinkingDelta)
    if (merged !== nextThinking) {
      nextThinking = merged
      changed = true
    }
  }
  if (!changed) return
  // In-place update for the single streaming row — avoid full-array map each token.
  snap.timelineItems[index] = {
    ...current,
    text: nextText,
    thinkingText: nextThinking,
  }
}

function flushBackgroundDeltas(): void {
  backgroundDeltaFlushScheduled = false
  if (backgroundDeltaPending.size === 0) return
  const keys = [...backgroundDeltaPending.keys()]
  for (const key of keys) {
    const pending = backgroundDeltaPending.get(key)
    backgroundDeltaPending.delete(key)
    if (!pending || (!pending.text && !pending.thinking)) continue
    const snap = liveTimelines.get(key)
    if (!snap?.streamingAssistantId) continue
    applyAssistantDeltaToSnap(snap, snap.streamingAssistantId, pending.text, pending.thinking)
    trimBackgroundLiveItems(snap)
  }
}

function scheduleBackgroundDeltaFlush(): void {
  if (backgroundDeltaFlushScheduled) return
  backgroundDeltaFlushScheduled = true
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => flushBackgroundDeltas())
  } else {
    setTimeout(() => flushBackgroundDeltas(), 0)
  }
}

/** Flush pending background stream text immediately (session switch / capture). */
export function flushBackgroundLiveDeltasSync(sessionFile?: string | null): void {
  if (sessionFile) {
    const key = cacheKey(sessionFile)
    const pending = backgroundDeltaPending.get(key)
    if (pending) {
      backgroundDeltaPending.delete(key)
      const snap = liveTimelines.get(key)
      if (snap?.streamingAssistantId) {
        applyAssistantDeltaToSnap(snap, snap.streamingAssistantId, pending.text, pending.thinking)
        trimBackgroundLiveItems(snap)
      }
    }
    return
  }
  flushBackgroundDeltas()
}

function queueBackgroundAssistantDelta(
  sessionFileKey: string,
  snap: LiveSessionTimelineSnapshot,
  event: Extract<AppEvent, { type: 'message' }>,
): void {
  const assistantId = ensureStreamingAssistant(snap, event)
  snap.agentTurnBootstrapping = false
  void assistantId
  let row = backgroundDeltaPending.get(sessionFileKey)
  if (!row) {
    row = { text: '', thinking: '' }
    backgroundDeltaPending.set(sessionFileKey, row)
  }
  if (event.contentKind === 'thinking') {
    row.thinking = mergeStreamChunk(row.thinking, event.text || '')
  } else {
    row.text = mergeStreamChunk(row.text, event.text || '')
  }
  scheduleBackgroundDeltaFlush()
}

function applyMessage(
  snap: LiveSessionTimelineSnapshot,
  event: Extract<AppEvent, { type: 'message' }>,
  sessionFileKey: string,
): void {
  if (event.role === 'assistant') {
    if (event.phase === 'start') {
      ensureStreamingAssistant(snap, event)
      snap.agentTurnBootstrapping = false
      return
    }
    if (event.phase === 'delta' && event.text) {
      queueBackgroundAssistantDelta(sessionFileKey, snap, event)
      return
    }
    if (event.phase === 'end') {
      // Apply any coalesced deltas before finalizing the assistant row.
      flushBackgroundLiveDeltasSync(sessionFileKey)
      const id = snap.streamingAssistantId
      snap.streamingAssistantId = null
      if (id) {
        const index = snap.timelineItems.findIndex((row) => row.id === id)
        if (index >= 0) {
          const current = snap.timelineItems[index]
          snap.timelineItems[index] = {
            ...current,
            text: event.text && event.text.trim() ? event.text : current.text,
            ...(event.sessionEntryId ? { sessionEntryId: event.sessionEntryId } : {}),
          }
        }
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
  const key = cacheKey(sessionFile)
  let snap = liveTimelines.get(key)
  if (!snap) {
    snap = {
      sessionId: null,
      sessionFile: key,
      timelineItems: [],
      streamingAssistantId: null,
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    }
    liveTimelines.set(key, snap)
  }
  return snap
}

function trimBackgroundLiveItems(snap: LiveSessionTimelineSnapshot): void {
  const max = BACKGROUND_LIVE_TIMELINE_MAX_ITEMS
  if (snap.timelineItems.length <= max) return
  const drop = snap.timelineItems.length - max
  const droppedIds = new Set(snap.timelineItems.slice(0, drop).map((item) => item.id))
  snap.timelineItems = snap.timelineItems.slice(drop)
  if (snap.streamingAssistantId && droppedIds.has(snap.streamingAssistantId)) {
    snap.streamingAssistantId = null
  }
}

export function applyBackgroundAppEventToLiveTimeline(sessionFile: string, event: AppEvent): void {
  const key = cacheKey(sessionFile)
  const snap = ensureLiveTimeline(sessionFile)
  if (event.type === 'message') {
    applyMessage(snap, event, key)
    // Deltas are rAF-batched; skip immediate view-heavy trim until flush (trim on flush/end).
    if (event.phase !== 'delta') trimBackgroundLiveItems(snap)
    return
  }
  if (event.type === 'tool') applyTool(snap, event)
  else if (event.type === 'queue') {
    snap.pendingSteering = [...event.steering]
    snap.pendingFollowUp = [...event.followUp]
  } else if (event.type === 'agent_error') {
    flushBackgroundLiveDeltasSync(key)
    snap.streamingAssistantId = null
    snap.agentTurnBootstrapping = false
    snap.runState = { ...snap.runState, status: event.kind === 'aborted' ? 'idle' : 'failed' }
  } else if (event.type === 'run') {
    if (event.phase === 'running' || event.phase === 'started') {
      snap.runState = { ...snap.runState, status: 'running', activeRunId: event.runId, startTime: event.timestamp }
    } else if (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled') {
      flushBackgroundLiveDeltasSync(key)
      // Turn finished: clear streaming markers so switch-back uses disk+merge, not a forever-active live path.
      snap.streamingAssistantId = null
      snap.agentTurnBootstrapping = false
      snap.optimisticPendingUserText = null
      snap.runState = {
        ...snap.runState,
        status: event.phase === 'failed' ? 'failed' : 'idle',
        activeRunId: undefined,
        activeTool: undefined,
        activeToolStatus: undefined,
      }
    }
  }
  trimBackgroundLiveItems(snap)
}

export function isLiveSessionRunning(sessionFile: string | undefined | null): boolean {
  if (!sessionFile) return false
  const snap = liveTimelines.get(cacheKey(sessionFile))
  return snap?.runState.status === 'running'
}
