import {
  mergeLiveCacheTimelineSnapshots,
  persistedTimelineBranchesConflict,
  resolveMergedStreamingAssistantId,
} from '@renderer/lib/streaming-timeline-preserve'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { normalizeTimelineMessageText } from '@renderer/lib/timeline-dedupe'
import { extractStatusFromOutput, extractTextFromToolOutput } from '@extension-compat/json-path'
import type { AppEvent } from '@shared/app-events'
import type { RunState, TimelineItem } from '@renderer/stores/ui-store-types'

export type LiveSessionTimelineSnapshot = {
  sessionId: string | null
  sessionFile: string
  timelineItems: TimelineItem[]
  persistedEntryOverlap?: string[]
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
export const BACKGROUND_LIVE_PERSISTED_OVERLAP_MAX = 16
let seq = 0

function cacheKey(sessionFile: string): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

function cloneItems(items: TimelineItem[]): TimelineItem[] {
  return items.map((i) => ({ ...i }))
}

function appendPersistedOverlap(overlap: string[], entryId: string): void {
  if (overlap.includes(entryId)) return
  overlap.push(entryId)
}

export function saveLiveSessionTimeline(snapshot: LiveSessionTimelineSnapshot): void {
  const key = cacheKey(snapshot.sessionFile)
  if (!key) return
  const prev = liveTimelines.get(key)
  const timelineBranchChanged = prev
    ? persistedTimelineBranchesConflict(snapshot.timelineItems, prev.timelineItems)
    : false
  const branchChanged =
    timelineBranchChanged ||
    (!!prev &&
      snapshot.persistedEntryOverlap != null &&
      snapshot.timelineItems.length < prev.timelineItems.length)
  const timelineItems = branchChanged
    ? cloneItems(snapshot.timelineItems)
    : mergeLiveCacheTimelineSnapshots(snapshot.timelineItems, prev?.timelineItems ?? [], {
        incomingStreamingAssistantId: snapshot.streamingAssistantId,
        existingStreamingAssistantId: prev?.streamingAssistantId,
      })
  const requestedStreamingId =
    snapshot.streamingAssistantId !== undefined
      ? snapshot.streamingAssistantId
      : (prev?.streamingAssistantId ?? null)
  const requestedStreamingItems =
    snapshot.streamingAssistantId !== undefined
      ? snapshot.timelineItems
      : (prev?.timelineItems ?? snapshot.timelineItems)
  const nextStreamingId = resolveMergedStreamingAssistantId(
    timelineItems,
    requestedStreamingItems,
    requestedStreamingId,
  )
  const nextSnapshot: LiveSessionTimelineSnapshot = {
    ...snapshot,
    sessionFile: key,
    timelineItems,
    persistedEntryOverlap: [
      ...(branchChanged
        ? (snapshot.persistedEntryOverlap ?? [])
        : (prev?.persistedEntryOverlap ?? snapshot.persistedEntryOverlap ?? [])),
    ].slice(-BACKGROUND_LIVE_PERSISTED_OVERLAP_MAX),
    streamingAssistantId: nextStreamingId,
    pendingSteering: [...snapshot.pendingSteering],
    pendingFollowUp: [...snapshot.pendingFollowUp],
  }
  trimBackgroundLiveItems(nextSnapshot)
  liveTimelines.set(key, nextSnapshot)
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
    persistedEntryOverlap: [...(snap.persistedEntryOverlap ?? [])],
    pendingSteering: [...snap.pendingSteering],
    pendingFollowUp: [...snap.pendingFollowUp],
  }
}

export function updateLiveSessionTimeline(
  sessionFile: string,
  update: (snapshot: LiveSessionTimelineSnapshot) => LiveSessionTimelineSnapshot,
): void {
  const key = cacheKey(sessionFile)
  if (!key) return
  flushBackgroundLiveDeltasSync(key)
  const snapshot = liveTimelines.get(key)
  if (!snapshot) return
  saveLiveSessionTimeline(update({
    ...snapshot,
    timelineItems: cloneItems(snapshot.timelineItems),
    persistedEntryOverlap: [...(snapshot.persistedEntryOverlap ?? [])],
    pendingSteering: [...snapshot.pendingSteering],
    pendingFollowUp: [...snapshot.pendingFollowUp],
  }))
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
  if (snap.streamingAssistantId) {
    const lastIndex = snap.timelineItems.length - 1
    const index =
      snap.timelineItems[lastIndex]?.id === snap.streamingAssistantId
        ? lastIndex
        : snap.timelineItems.findIndex((row) => row.id === snap.streamingAssistantId)
    if (index >= 0) {
      const current = snap.timelineItems[index]
      const runId = event.runId ?? current.runId
      const turnId = event.turnId ?? current.turnId
      if (current.runId !== runId || current.turnId !== turnId) {
        snap.timelineItems[index] = { ...current, runId, turnId }
      }
    }
    return snap.streamingAssistantId
  }
  const id = nextCachedItemId()
  snap.timelineItems.push({
    id,
    type: 'assistant-message',
    text: '',
    thinkingText: '',
    runId: event.runId,
    turnId: event.turnId,
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
    nextText += textDelta
    changed = true
  }
  if (thinkingDelta) {
    nextThinking += thinkingDelta
    changed = true
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
    row.thinking += event.text || ''
  } else {
    row.text += event.text || ''
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
            runId: event.runId,
            turnId: event.turnId,
            ...(event.sessionEntryId ? { sessionEntryId: event.sessionEntryId } : {}),
          }
        }
      }
      return
    }
  }

  if (event.role === 'user' && event.phase === 'start') {
    const incomingText = normalizeTimelineMessageText(event.text)
    const optimisticText = normalizeTimelineMessageText(
      snap.optimisticPendingUserText ?? undefined,
    )
    let lastUserIndex = -1
    for (let itemIndex = snap.timelineItems.length - 1; itemIndex >= 0; itemIndex--) {
      if (snap.timelineItems[itemIndex].type === 'user-message') {
        lastUserIndex = itemIndex
        break
      }
    }
    const lastUser = lastUserIndex >= 0 ? snap.timelineItems[lastUserIndex] : undefined
    const lastUserText = normalizeTimelineMessageText(lastUser?.text)
    const matchesOptimistic =
      !!lastUser && !!optimisticText && lastUserText === optimisticText

    if (matchesOptimistic) {
      snap.timelineItems[lastUserIndex] = {
        ...lastUser,
        text: incomingText ? event.text : lastUser.text,
        runId: event.runId,
        turnId: event.turnId,
        timestamp: event.timestamp,
      }
    } else {
      snap.timelineItems.push({
        id: nextCachedItemId(),
        type: 'user-message',
        text: event.text || '',
        runId: event.runId,
        turnId: event.turnId,
        timestamp: event.timestamp,
      })
    }
    snap.optimisticPendingUserText = null
    snap.agentTurnBootstrapping = false
    return
  }

  if (event.role === 'user' && event.phase === 'end' && event.sessionEntryId) {
    for (let itemIndex = snap.timelineItems.length - 1; itemIndex >= 0; itemIndex--) {
      const item = snap.timelineItems[itemIndex]
      if (item.type === 'user-message' && !item.sessionEntryId) {
        snap.timelineItems[itemIndex] = {
          ...item,
          sessionEntryId: event.sessionEntryId,
          runId: event.runId,
          turnId: event.turnId,
        }
        break
      }
    }
  }
}

function applyTool(
  snap: LiveSessionTimelineSnapshot,
  event: Extract<AppEvent, { type: 'tool' }>,
  sessionFileKey: string,
): void {
  if (event.phase === 'start') {
    flushBackgroundLiveDeltasSync(sessionFileKey)
    snap.streamingAssistantId = null
    snap.timelineItems.push({
      id: nextCachedItemId(),
      type: 'tool-call',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      toolPhase: 'start',
      toolArgs: event.input,
      runId: event.runId,
      turnId: event.turnId,
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
  if (event.phase === 'update') {
    const statusLine = extractStatusFromOutput(event.output)
    snap.timelineItems[realIdx] = {
      ...item,
      toolPhase: 'update',
      ...(statusLine ? { toolStatusLine: statusLine } : {}),
      ...(event.details !== undefined ? { toolDetails: event.details } : {}),
      runId: event.runId,
      turnId: event.turnId,
    }
    snap.runState = {
      ...snap.runState,
      activeTool: event.toolName,
      ...(statusLine ? { activeToolStatus: statusLine } : {}),
    }
    return
  }
  if (event.phase === 'end') {
    const readableOutput = extractTextFromToolOutput(event.output)
    snap.timelineItems[realIdx] = {
      ...item,
      toolPhase: 'end',
      toolOutput: readableOutput || (event.output == null ? '' : JSON.stringify(event.output, null, 2)),
      toolDetails: event.details,
      toolStatusLine: undefined,
      runId: event.runId,
      turnId: event.turnId,
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
      persistedEntryOverlap: [],
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
  const dropped = snap.timelineItems.slice(0, drop)
  const droppedIds = new Set(dropped.map((item) => item.id))
  const persistedEntryOverlap = [...(snap.persistedEntryOverlap ?? [])]
  for (const item of dropped) {
    const entryId = item.sessionEntryId
    if (entryId) appendPersistedOverlap(persistedEntryOverlap, entryId)
  }
  snap.persistedEntryOverlap = persistedEntryOverlap.slice(
    -BACKGROUND_LIVE_PERSISTED_OVERLAP_MAX,
  )
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
  if (event.type === 'tool') applyTool(snap, event, key)
  else if (event.type === 'queue') {
    snap.pendingSteering = [...event.steering]
    snap.pendingFollowUp = [...event.followUp]
  } else if (event.type === 'agent_error') {
    flushBackgroundLiveDeltasSync(key)
    const stopReason = event.kind === 'aborted' ? 'aborted' : 'error'
    if (snap.streamingAssistantId) {
      const streamId = snap.streamingAssistantId
      snap.timelineItems = snap.timelineItems.map((item) =>
        item.id === streamId ? { ...item, incomplete: true, stopReason } : item,
      )
    } else {
      for (let index = snap.timelineItems.length - 1; index >= 0; index--) {
        const row = snap.timelineItems[index]
        if (row.type === 'user-message') break
        if (row.type === 'assistant-message') {
          snap.timelineItems[index] = { ...row, incomplete: true, stopReason }
          break
        }
      }
    }
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

/**
 * Visible-route turn terminal: retire stale streaming markers so later switch-backs
 * trust disk instead of resurrecting a mid-stream snapshot (running badge / steer swallow).
 */
export function markLiveSessionTurnEnded(
  sessionFile: string,
  status: 'idle' | 'failed',
): void {
  const key = cacheKey(sessionFile)
  const snap = liveTimelines.get(key)
  if (!snap) return
  flushBackgroundLiveDeltasSync(key)
  snap.streamingAssistantId = null
  snap.agentTurnBootstrapping = false
  snap.optimisticPendingUserText = null
  snap.runState = {
    ...snap.runState,
    status,
    activeRunId: undefined,
    activeTool: undefined,
    activeToolStatus: undefined,
  }
}

export function isLiveSessionRunning(sessionFile: string | undefined | null): boolean {
  if (!sessionFile) return false
  const snap = liveTimelines.get(cacheKey(sessionFile))
  return snap?.runState.status === 'running'
}
