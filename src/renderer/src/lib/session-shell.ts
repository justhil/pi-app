/**
 * Conversation Session Shell — per-session view cache + focus switch.
 *
 * Product rules (locked):
 * - Cache hit: zero full-screen skeleton; bind cached items immediately.
 * - Max 12 views in memory; running sessions are never evicted.
 * - Run UI authority: sessionRuntimeRunning / bound worker snap / local streaming — never bare runState.
 *
 * @see docs/dev/conversation-session-shell.md
 */
import { ipcClient } from '@renderer/lib/ipc-client'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'
import { fetchSessionHistoryTail } from '@renderer/lib/session-history'
import { sanitizeHistoryTimeline } from '@renderer/lib/timeline-dedupe'
import { projectTimelineItems } from '@shared/timeline-projection'
import { getLiveSessionTimeline } from '@renderer/lib/live-session-timeline-cache'
import { mergeLiveTimelineWithHistoryTail } from '@renderer/lib/merge-live-history-timeline'
import {
  applyLiveStreamingTextToMergedTimeline,
  resolveMergedStreamingAssistantId,
} from '@renderer/lib/streaming-timeline-preserve'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { useUIStore } from '@renderer/stores/ui-store'
import type { RunState, TimelineItem } from '@renderer/stores/ui-store-types'
import { flushStreamPendingSync } from '@renderer/stores/ui-store-stream'

/** Product default: max cached session views (running pinned separately). */
export const MAX_SESSION_VIEWS = 12

export type SessionRunUI = 'idle' | 'running' | 'failed'

export type SessionViewPhase = 'empty' | 'cached' | 'hydrating' | 'ready' | 'error'

export type SessionView = {
  sessionKey: string
  sessionId: string | null
  items: TimelineItem[]
  historyTotal: number
  historyLoaded: number
  runUI: SessionRunUI
  streamingAssistantId: string | null
  optimisticPendingUserText: string | null
  agentTurnBootstrapping: boolean
  pendingSteering: string[]
  pendingFollowUp: string[]
  phase: SessionViewPhase
  lastFocusedAt: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
}

const views = new Map<string, SessionView>()
let focusKey: string | null = null

export function sessionKeyFromFile(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

export function getFocusSessionKey(): string | null {
  return focusKey
}

export function getSessionView(sessionFile: string | null | undefined): SessionView | null {
  const key = sessionKeyFromFile(sessionFile)
  if (!key) return null
  return views.get(key) ?? null
}

export function listSessionViewKeys(): string[] {
  return [...views.keys()]
}

function emptyView(sessionKey: string, sessionId: string | null): SessionView {
  return {
    sessionKey,
    sessionId,
    items: [],
    historyTotal: 0,
    historyLoaded: 0,
    runUI: 'idle',
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    pendingSteering: [],
    pendingFollowUp: [],
    phase: 'empty',
    lastFocusedAt: Date.now(),
  }
}

function cloneItems(items: TimelineItem[]): TimelineItem[] {
  return items.map((item) => ({ ...item }))
}

function isViewRunning(view: SessionView, runtime: Record<string, boolean>): boolean {
  if (view.runUI === 'running') return true
  if (runtime[view.sessionKey] === true) return true
  for (const [runtimeKey, running] of Object.entries(runtime)) {
    if (running && sessionFilesEqual(runtimeKey, view.sessionKey)) return true
  }
  return false
}

/** LRU eviction; never drop running sessions. */
export function evictSessionViewsIfNeeded(runtime?: Record<string, boolean>): void {
  const runtimeMap = runtime ?? useUIStore.getState().sessionRuntimeRunning ?? {}
  if (views.size <= MAX_SESSION_VIEWS) return

  const candidates = [...views.values()]
    .filter((view) => !isViewRunning(view, runtimeMap) && view.sessionKey !== focusKey)
    .sort((a, b) => a.lastFocusedAt - b.lastFocusedAt)

  let overflow = views.size - MAX_SESSION_VIEWS
  for (const view of candidates) {
    if (overflow <= 0) break
    views.delete(view.sessionKey)
    overflow--
  }
}

function resolveRunUI(
  sessionKey: string,
  input: {
    runtime: Record<string, boolean>
    streamingAssistantId: string | null
    optimisticPendingUserText: string | null
    agentTurnBootstrapping: boolean
    workerSessionFile: string | null
    workerStatus: 'idle' | 'running' | 'failed' | 'unknown'
  },
): SessionRunUI {
  if (input.runtime[sessionKey] === true) return 'running'
  for (const [runtimeKey, running] of Object.entries(input.runtime)) {
    if (running && sessionFilesEqual(runtimeKey, sessionKey)) return 'running'
  }
  if (
    sessionFilesEqual(input.workerSessionFile, sessionKey) &&
    input.workerStatus === 'running'
  ) {
    return 'running'
  }
  if (
    input.streamingAssistantId != null ||
    input.optimisticPendingUserText != null ||
    input.agentTurnBootstrapping
  ) {
    return 'running'
  }
  if (sessionFilesEqual(input.workerSessionFile, sessionKey) && input.workerStatus === 'failed') {
    return 'failed'
  }
  return 'idle'
}

/**
 * Snapshot the currently displayed conversation into the shell cache (call before focus change).
 */
export function captureFocusFromUiStore(): void {
  const state = useUIStore.getState()
  const viewFile = state.historySessionFile
  if (!viewFile) return

  flushStreamPendingSync(useUIStore.getState, useUIStore.setState)
  const latest = useUIStore.getState()
  const sessionKey = sessionKeyFromFile(viewFile)
  if (!sessionKey) return

  const runUI = resolveRunUI(sessionKey, {
    runtime: latest.sessionRuntimeRunning ?? {},
    streamingAssistantId: latest.streamingAssistantId,
    optimisticPendingUserText: latest.optimisticPendingUserText,
    agentTurnBootstrapping: latest.agentTurnBootstrapping,
    workerSessionFile: latest.workerLiveSnapshot.sessionFile,
    workerStatus: latest.workerLiveSnapshot.status,
  })

  const prev = views.get(sessionKey)
  const items =
    latest.timelineItems.length > 0
      ? cloneItems(latest.timelineItems)
      : prev?.items
        ? cloneItems(prev.items)
        : []

  if (items.length === 0 && runUI === 'idle' && !prev) return

  views.set(sessionKey, {
    sessionKey,
    sessionId: latest.currentSessionId,
    items,
    historyTotal: Math.max(latest.historyTotalCount, prev?.historyTotal ?? 0),
    historyLoaded: Math.max(latest.historyLoadedCount, prev?.historyLoaded ?? 0),
    runUI,
    streamingAssistantId: latest.streamingAssistantId,
    optimisticPendingUserText: latest.optimisticPendingUserText,
    agentTurnBootstrapping: latest.agentTurnBootstrapping,
    pendingSteering: [...latest.pendingSteering],
    pendingFollowUp: [...latest.pendingFollowUp],
    phase: items.length > 0 ? 'cached' : (prev?.phase ?? 'empty'),
    lastFocusedAt: Date.now(),
    sessionMeta: prev?.sessionMeta,
  })
  evictSessionViewsIfNeeded(latest.sessionRuntimeRunning)
}

/**
 * Push a SessionView into the global display store (Timeline / Composer / Chrome).
 * Does not set historyLoading — caller decides.
 */
export function bindViewToUiStore(view: SessionView): void {
  const state = useUIStore.getState()
  const runtime = state.sessionRuntimeRunning ?? {}
  const runtimeRunning =
    runtime[view.sessionKey] === true ||
    Object.entries(runtime).some(
      ([runtimeKey, running]) => running === true && sessionFilesEqual(runtimeKey, view.sessionKey),
    )
  const live = getLiveSessionTimeline(view.sessionKey)
  const liveRunning =
    live?.runState.status === 'running' ||
    live?.streamingAssistantId != null ||
    live?.optimisticPendingUserText != null ||
    live?.agentTurnBootstrapping === true

  // Prefer the strongest running signal: shell view, runtime map, or live cache.
  const effectiveRunUI: SessionRunUI =
    view.runUI === 'failed'
      ? 'failed'
      : view.runUI === 'running' || runtimeRunning || liveRunning
        ? 'running'
        : 'idle'

  const status: RunState['status'] =
    effectiveRunUI === 'running' ? 'running' : effectiveRunUI === 'failed' ? 'failed' : 'idle'

  // Re-assert runtime map when we know the session is still active (switch-back safety).
  if (effectiveRunUI === 'running') {
    state.setSessionRuntimeRunning(view.sessionKey, true)
  }

  const streamCandidateItems =
    live && view.streamingAssistantId === live.streamingAssistantId
      ? live.timelineItems
      : view.items
  const streamingAssistantId = resolveMergedStreamingAssistantId(
    view.items,
    streamCandidateItems,
    view.streamingAssistantId,
  )
  const optimisticPendingUserText = view.optimisticPendingUserText
  const agentTurnBootstrapping = view.agentTurnBootstrapping

  useUIStore.setState({
    currentSessionId: view.sessionId,
    historySessionFile: view.sessionKey,
    historyTotalCount: view.historyTotal,
    historyLoadedCount: view.historyLoaded,
    timelineItems: cloneItems(view.items),
    streamingAssistantId,
    optimisticPendingUserText,
    agentTurnBootstrapping,
    pendingSteering: [...view.pendingSteering],
    pendingFollowUp: [...view.pendingFollowUp],
    runState: {
      ...state.runState,
      ...(live?.runState ?? {}),
      status,
      activeTool:
        effectiveRunUI === 'running'
          ? (live?.runState.activeTool ?? state.runState.activeTool)
          : undefined,
      activeToolStatus:
        effectiveRunUI === 'running'
          ? (live?.runState.activeToolStatus ?? state.runState.activeToolStatus)
          : undefined,
      activeRunId:
        effectiveRunUI === 'running'
          ? (live?.runState.activeRunId ?? state.runState.activeRunId)
          : undefined,
    },
    workerLiveSnapshot: {
      sessionId: view.sessionId,
      sessionFile: view.sessionKey,
      status: effectiveRunUI === 'running' ? 'running' : effectiveRunUI === 'failed' ? 'failed' : 'idle',
    },
  })
}

function mergeLiveIntoItems(sessionKey: string, diskItems: TimelineItem[]): TimelineItem[] {
  const live = getLiveSessionTimeline(sessionKey)
  if (!live || live.timelineItems.length === 0) {
    return projectTimelineItems(diskItems) as TimelineItem[]
  }
  let merged = mergeLiveTimelineWithHistoryTail(
    diskItems,
    live.timelineItems,
    live.persistedEntryOverlap,
  )
  merged = applyLiveStreamingTextToMergedTimeline(
    merged,
    live.timelineItems,
    live.streamingAssistantId,
  )
  return projectTimelineItems(merged) as TimelineItem[]
}

/** Prefer the timeline that keeps more user turns and structure (anti misalignment). */
function timelineRichnessScore(items: TimelineItem[]): number {
  const users = items.reduce((n, item) => (item.type === 'user-message' ? n + 1 : n), 0)
  const asstChars = items.reduce(
    (n, item) =>
      item.type === 'assistant-message'
        ? n + (item.text?.length ?? 0) + (item.thinkingText?.length ?? 0)
        : n,
    0,
  )
  return users * 1_000_000_000 + items.length * 1_000_000 + asstChars
}

function pickRicherTimeline(a: TimelineItem[], b: TimelineItem[]): TimelineItem[] {
  return timelineRichnessScore(a) >= timelineRichnessScore(b) ? a : b
}

/**
 * Sync focus pointer and bind cache immediately. Returns whether cache had items (instant path).
 */
export function focusSessionSync(sessionId: string, sessionFile: string): {
  sessionKey: string
  instant: boolean
  view: SessionView
} {
  captureFocusFromUiStore()

  const sessionKey = sessionKeyFromFile(sessionFile)
  focusKey = sessionKey

  let view = views.get(sessionKey)
  if (!view) {
    view = emptyView(sessionKey, sessionId)
    views.set(sessionKey, view)
  } else {
    view = {
      ...view,
      sessionId: sessionId ?? view.sessionId,
      lastFocusedAt: Date.now(),
    }
    // Refresh runUI + re-merge live stream so switch-back does not paint stale order.
    const runtime = useUIStore.getState().sessionRuntimeRunning ?? {}
    const live = getLiveSessionTimeline(sessionKey)
    const runtimeRunning =
      runtime[sessionKey] === true ||
      Object.entries(runtime).some(([k, v]) => v && sessionFilesEqual(k, sessionKey))
    const liveRunning =
      live?.runState.status === 'running' ||
      live?.streamingAssistantId != null ||
      live?.optimisticPendingUserText != null ||
      live?.agentTurnBootstrapping === true
    const remixedItems =
      view.items.length > 0 ? mergeLiveIntoItems(sessionKey, view.items) : view.items
    const remixedStreamingAssistantId = resolveMergedStreamingAssistantId(
      remixedItems,
      live?.timelineItems ?? view.items,
      live ? live.streamingAssistantId : view.streamingAssistantId,
    )
    if (runtimeRunning || liveRunning || view.runUI === 'running') {
      view = {
        ...view,
        items: remixedItems,
        runUI: 'running',
        streamingAssistantId: remixedStreamingAssistantId,
        optimisticPendingUserText: live
          ? live.optimisticPendingUserText
          : view.optimisticPendingUserText,
        agentTurnBootstrapping: live
          ? live.agentTurnBootstrapping
          : view.agentTurnBootstrapping,
      }
    } else {
      const resolved = resolveRunUI(sessionKey, {
        runtime,
        streamingAssistantId: remixedStreamingAssistantId,
        optimisticPendingUserText: view.optimisticPendingUserText,
        agentTurnBootstrapping: view.agentTurnBootstrapping,
        workerSessionFile: sessionKey,
        workerStatus: 'idle',
      })
      view = {
        ...view,
        items: remixedItems,
        runUI: resolved,
        streamingAssistantId: remixedStreamingAssistantId,
      }
    }
    views.set(sessionKey, view)
  }

  // Any non-empty cache paints immediately — even if a previous hydrate left phase='hydrating'
  // (user switched away mid-fetch). Streaming switch-back must never stick on skeleton.
  const instant = view.items.length > 0
  if (instant && view.phase !== 'ready' && view.phase !== 'cached') {
    view = { ...view, phase: 'cached', lastFocusedAt: Date.now() }
    views.set(sessionKey, view)
  }
  // Set loading BEFORE bind so empty cold targets never paint one frame of "empty chat".
  useUIStore.getState().setHistoryLoading(!instant)
  bindViewToUiStore(view)
  useUIStore.getState().clearFileChanges()
  evictSessionViewsIfNeeded()

  return { sessionKey, instant, view }
}

/**
 * Background / cold hydrate: disk tail + live merge. Cancelled via navToken.
 */
export async function hydrateSessionView(
  sessionKey: string,
  sessionId: string | null,
  navToken?: number,
  options?: { bindWorker?: boolean },
): Promise<void> {
  if (navToken != null && !assertSessionNavigation(navToken)) return

  const existing = views.get(sessionKey)
  const priorItems = existing?.items?.length ? cloneItems(existing.items) : []
  const priorPhase = existing?.phase
  if (existing) {
    // Keep items while hydrating; only mark phase for diagnostics.
    views.set(sessionKey, {
      ...existing,
      phase: existing.items.length > 0 ? existing.phase : 'hydrating',
    })
  }

  const restorePhaseIfUnfocused = (): void => {
    // User left this session mid-hydrate — never leave phase stuck as hydrating
    // or switch-back treats non-empty cache as cold open (endless skeleton).
    const current = views.get(sessionKey)
    if (!current) return
    if (current.phase === 'ready' || current.phase === 'cached' || current.phase === 'error') return
    const phase: SessionViewPhase =
      current.items.length > 0 ? 'cached' : priorPhase === 'ready' ? 'ready' : 'empty'
    views.set(sessionKey, { ...current, phase })
  }

  try {
    // Prefer single tail fetch for speed; bypass slice cache only when empty view.
    // Disk-first IPC — must not spawn worker (see session.getMessages).
    const bypass = !existing?.items.length
    const hist = await fetchSessionHistoryTail(sessionKey, 80, { bypassCache: bypass })
    if (navToken != null && !assertSessionNavigation(navToken)) {
      restorePhaseIfUnfocused()
      return
    }
    if (focusKey && !sessionFilesEqual(focusKey, sessionKey)) {
      // Still merge disk into cache in background so next focus is fresh, but do not bind.
      if (!hist.error && hist.items) {
        const diskItems = sanitizeHistoryTimeline(hist.items as TimelineItem[])
        const projected = projectTimelineItems(diskItems) as TimelineItem[]
        const merged = mergeLiveIntoItems(sessionKey, projected)
        // Prefer richer of disk-merge vs prior (streaming capture often longer than disk mid-turn)
        const prefer =
          merged.length >= priorItems.length || timelineItemTextScore(merged) >= timelineItemTextScore(priorItems)
            ? merged
            : priorItems
        const live = getLiveSessionTimeline(sessionKey)
        const runtime = useUIStore.getState().sessionRuntimeRunning ?? {}
        const streamingAssistantId = resolveMergedStreamingAssistantId(
          prefer,
          live?.timelineItems ?? existing?.items ?? prefer,
          live ? live.streamingAssistantId : (existing?.streamingAssistantId ?? null),
        )
        const runUI = resolveRunUI(sessionKey, {
          runtime,
          streamingAssistantId,
          optimisticPendingUserText: live?.optimisticPendingUserText ?? null,
          agentTurnBootstrapping: live?.agentTurnBootstrapping ?? false,
          workerSessionFile: sessionKey,
          workerStatus:
            runtime[sessionKey] ||
            Object.entries(runtime).some(([k, v]) => v && sessionFilesEqual(k, sessionKey))
              ? 'running'
              : 'idle',
        })
        views.set(sessionKey, {
          sessionKey,
          sessionId: sessionId ?? existing?.sessionId ?? null,
          items: cloneItems(prefer),
          historyTotal: Math.max(hist.totalCount, existing?.historyTotal ?? 0),
          historyLoaded: Math.max(hist.sourceCount, existing?.historyLoaded ?? 0),
          runUI,
          streamingAssistantId,
          optimisticPendingUserText: live
            ? live.optimisticPendingUserText
            : (existing?.optimisticPendingUserText ?? null),
          agentTurnBootstrapping: live
            ? live.agentTurnBootstrapping
            : (existing?.agentTurnBootstrapping ?? false),
          pendingSteering: live?.pendingSteering
            ? [...live.pendingSteering]
            : existing?.pendingSteering
              ? [...existing.pendingSteering]
              : [],
          pendingFollowUp: live?.pendingFollowUp
            ? [...live.pendingFollowUp]
            : existing?.pendingFollowUp
              ? [...existing.pendingFollowUp]
              : [],
          phase: prefer.length > 0 ? 'cached' : 'empty',
          lastFocusedAt: existing?.lastFocusedAt ?? Date.now(),
          sessionMeta: hist.sessionMeta ?? existing?.sessionMeta,
        })
      } else {
        restorePhaseIfUnfocused()
      }
      return
    }

    if (hist.error) {
      const failed = views.get(sessionKey) ?? emptyView(sessionKey, sessionId)
      // Keep prior items on error so switch-back still paints
      views.set(sessionKey, {
        ...failed,
        items: failed.items.length ? failed.items : priorItems,
        phase: failed.items.length || priorItems.length ? 'cached' : 'error',
      })
      if (sessionFilesEqual(focusKey, sessionKey)) {
        useUIStore.getState().setHistoryLoading(false)
      }
      return
    }

    const focusedHere = sessionFilesEqual(focusKey, sessionKey)
    let focusedState: ReturnType<typeof useUIStore.getState> | null = null
    if (focusedHere && sessionFilesEqual(useUIStore.getState().historySessionFile, sessionKey)) {
      flushStreamPendingSync(useUIStore.getState, useUIStore.setState)
      focusedState = useUIStore.getState()
    }

    const diskItems = sanitizeHistoryTimeline(hist.items as TimelineItem[])
    const projected = projectTimelineItems(diskItems) as TimelineItem[]
    let merged = mergeLiveIntoItems(sessionKey, projected)
    // Mid-stream disk is often shorter than the live capture we just left —
    // never replace a richer in-memory timeline with a thinner disk snapshot.
    // Always re-merge through live (never assign raw priorItems alone — drops tools / misorders).
    if (
      priorItems.length > 0 &&
      (timelineItemTextScore(priorItems) > timelineItemTextScore(merged) ||
        priorItems.length > merged.length)
    ) {
      const fromPrior = mergeLiveIntoItems(sessionKey, priorItems)
      merged = pickRicherTimeline(fromPrior, merged)
    }

    if (focusedState?.timelineItems.length) {
      const focusedItems = projectTimelineItems(focusedState.timelineItems) as TimelineItem[]
      const withFocusedTail = mergeLiveTimelineWithHistoryTail(projected, focusedItems)
      merged = pickRicherTimeline(withFocusedTail, merged)
    }

    const live = getLiveSessionTimeline(sessionKey)
    const runtime = useUIStore.getState().sessionRuntimeRunning ?? {}
    // Do NOT await worker getState on every hydrate — freezes switches when pool is busy.
    // Runtime map + live cache cover running badges.

    const priorRunUI = existing?.runUI
    const runtimeSaysRunning =
      runtime[sessionKey] === true ||
      Object.entries(runtime).some(([k, v]) => v && sessionFilesEqual(k, sessionKey))
    const liveSaysRunning =
      live?.runState.status === 'running' ||
      live?.streamingAssistantId != null ||
      live?.optimisticPendingUserText != null ||
      live?.agentTurnBootstrapping === true

    const streamCandidateItems = focusedState
      ? focusedState.timelineItems
      : live
        ? live.timelineItems
        : (existing?.items ?? merged)
    const streamCandidateId = focusedState
      ? focusedState.streamingAssistantId
      : live
        ? live.streamingAssistantId
        : (existing?.streamingAssistantId ?? null)
    const streamingAssistantId = resolveMergedStreamingAssistantId(
      merged,
      streamCandidateItems,
      streamCandidateId,
    )
    const optimisticPendingUserText = focusedState
      ? focusedState.optimisticPendingUserText
      : live
        ? live.optimisticPendingUserText
        : (existing?.optimisticPendingUserText ?? null)
    const agentTurnBootstrapping = focusedState
      ? focusedState.agentTurnBootstrapping
      : live
        ? live.agentTurnBootstrapping
        : (existing?.agentTurnBootstrapping ?? false)

    const runUI = resolveRunUI(sessionKey, {
      runtime,
      streamingAssistantId,
      optimisticPendingUserText,
      agentTurnBootstrapping,
      workerSessionFile: sessionKey,
      workerStatus:
        runtimeSaysRunning || liveSaysRunning || priorRunUI === 'running' ? 'running' : 'idle',
    })
    // Never demote a still-running session to idle just because disk hydrate lacks markers.
    const finalRunUI: SessionRunUI =
      runUI === 'failed'
        ? 'failed'
        : runUI === 'running' || priorRunUI === 'running' || runtimeSaysRunning || liveSaysRunning
          ? 'running'
          : 'idle'

    if (finalRunUI === 'running') {
      useUIStore.getState().setSessionRuntimeRunning(sessionKey, true)
    }

    const next: SessionView = {
      sessionKey,
      sessionId: sessionId ?? existing?.sessionId ?? null,
      items: cloneItems(merged),
      historyTotal: hist.totalCount,
      historyLoaded: Math.min(hist.totalCount, hist.sourceCount),
      runUI: finalRunUI,
      streamingAssistantId,
      optimisticPendingUserText,
      agentTurnBootstrapping,
      pendingSteering: live?.pendingSteering
        ? [...live.pendingSteering]
        : existing?.pendingSteering
          ? [...existing.pendingSteering]
          : [],
      pendingFollowUp: live?.pendingFollowUp
        ? [...live.pendingFollowUp]
        : existing?.pendingFollowUp
          ? [...existing.pendingFollowUp]
          : [],
      phase: 'ready',
      lastFocusedAt: Date.now(),
      sessionMeta: hist.sessionMeta,
    }
    views.set(sessionKey, next)

    if (sessionFilesEqual(focusKey, sessionKey)) {
      bindViewToUiStore(next)
      if (options?.bindWorker !== false) {
        // Normal conversations bind before showing composer meta/context.
        await ipcClient.invoke('session.setPendingBind', { sessionFile: sessionKey }).catch(() => {})
      }
      useUIStore.getState().setHistoryLoading(false)
      void applyComposerDisplayMeta(hist.sessionMeta)
    }
  } catch (error) {
    console.error('[session-shell] hydrate failed:', error)
    restorePhaseIfUnfocused()
    if (navToken != null && !assertSessionNavigation(navToken)) return
    if (sessionFilesEqual(focusKey, sessionKey)) {
      useUIStore.getState().setHistoryLoading(false)
    }
  }
}

/** Rough richness score: prefer timelines with more user rows + longer assistant text. */
function timelineItemTextScore(items: TimelineItem[]): number {
  let score = items.length * 1_000
  for (const item of items) {
    if (item.type === 'user-message') score += 1_000_000
    if (item.type === 'assistant-message') {
      score += (item.text?.length ?? 0) + (item.thinkingText?.length ?? 0)
    }
  }
  return score
}

/**
 * Full focus switch: sync bind + async hydrate (cancellable).
 * @returns true if instant cache path was used
 */
export async function focusSession(
  sessionId: string,
  sessionFile: string,
  navToken?: number,
): Promise<{ instant: boolean }> {
  const { sessionKey, instant } = focusSessionSync(sessionId, sessionFile)

  // Always revalidate in background; instant path stays interactive without skeleton
  await hydrateSessionView(sessionKey, sessionId, navToken)
  return { instant }
}

/** Test helper: clear all views */
export function clearSessionShellForTests(): void {
  views.clear()
  focusKey = null
}
