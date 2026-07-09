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
import { applyLiveStreamingTextToMergedTimeline } from '@renderer/lib/streaming-timeline-preserve'
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
    workerStatus: 'idle' | 'running' | 'failed'
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
    historyTotal: Math.max(latest.historyTotalCount, items.length, prev?.historyTotal ?? 0),
    historyLoaded: Math.max(latest.historyLoadedCount, items.length, prev?.historyLoaded ?? 0),
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
  const status: RunState['status'] =
    view.runUI === 'running' ? 'running' : view.runUI === 'failed' ? 'failed' : 'idle'

  useUIStore.setState({
    currentSessionId: view.sessionId,
    historySessionFile: view.sessionKey,
    historyTotalCount: view.historyTotal,
    historyLoadedCount: view.historyLoaded,
    timelineItems: cloneItems(view.items),
    streamingAssistantId: view.streamingAssistantId,
    optimisticPendingUserText: view.optimisticPendingUserText,
    agentTurnBootstrapping: view.agentTurnBootstrapping,
    pendingSteering: [...view.pendingSteering],
    pendingFollowUp: [...view.pendingFollowUp],
    runState: {
      ...state.runState,
      status,
      activeTool: undefined,
      activeToolStatus: undefined,
      activeRunId: view.runUI === 'running' ? state.runState.activeRunId : undefined,
    },
    workerLiveSnapshot: {
      sessionId: view.sessionId,
      sessionFile: view.sessionKey,
      status: view.runUI === 'running' ? 'running' : view.runUI === 'failed' ? 'failed' : 'idle',
    },
  })
}

function mergeLiveIntoItems(sessionKey: string, diskItems: TimelineItem[]): TimelineItem[] {
  const live = getLiveSessionTimeline(sessionKey)
  if (!live || live.timelineItems.length === 0) return diskItems
  let merged = mergeLiveTimelineWithHistoryTail(diskItems, live.timelineItems)
  merged = applyLiveStreamingTextToMergedTimeline(
    merged,
    live.timelineItems,
    live.streamingAssistantId,
  )
  return projectTimelineItems(merged) as TimelineItem[]
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
    // Refresh runUI from current runtime map (session may still be streaming in background)
    const runtime = useUIStore.getState().sessionRuntimeRunning ?? {}
    const runUI = resolveRunUI(sessionKey, {
      runtime,
      streamingAssistantId: view.streamingAssistantId,
      optimisticPendingUserText: view.optimisticPendingUserText,
      agentTurnBootstrapping: view.agentTurnBootstrapping,
      workerSessionFile: sessionKey,
      workerStatus: view.runUI === 'running' ? 'running' : 'idle',
    })
    // If runtime says running, force runUI even if view was idle when last captured
    if (runtime[sessionKey] || Object.entries(runtime).some(([k, v]) => v && sessionFilesEqual(k, sessionKey))) {
      view = { ...view, runUI: 'running' }
    } else if (view.runUI === 'running' && runUI === 'idle') {
      // Keep streaming markers if any
      if (!view.streamingAssistantId && !view.optimisticPendingUserText) {
        view = { ...view, runUI: 'idle' }
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
        const runUI = resolveRunUI(sessionKey, {
          runtime,
          streamingAssistantId: live?.streamingAssistantId ?? null,
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
          historyTotal: Math.max(hist.totalCount, prefer.length, existing?.historyTotal ?? 0),
          historyLoaded: Math.max(prefer.length, existing?.historyLoaded ?? 0),
          runUI,
          streamingAssistantId: live?.streamingAssistantId ?? existing?.streamingAssistantId ?? null,
          optimisticPendingUserText:
            live?.optimisticPendingUserText ?? existing?.optimisticPendingUserText ?? null,
          agentTurnBootstrapping:
            live?.agentTurnBootstrapping ?? existing?.agentTurnBootstrapping ?? false,
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

    const diskItems = sanitizeHistoryTimeline(hist.items as TimelineItem[])
    const projected = projectTimelineItems(diskItems) as TimelineItem[]
    let merged = mergeLiveIntoItems(sessionKey, projected)
    // Mid-stream disk is often shorter than the live capture we just left —
    // never replace a richer in-memory timeline with a thinner disk snapshot.
    if (
      priorItems.length > 0 &&
      (timelineItemTextScore(priorItems) > timelineItemTextScore(merged) ||
        priorItems.length > merged.length)
    ) {
      merged = mergeLiveIntoItems(sessionKey, priorItems)
      // Still prefer disk prefix + live tail if merge of disk already applied above failed richness
      if (timelineItemTextScore(priorItems) >= timelineItemTextScore(merged)) {
        merged = priorItems
      }
    }

    const live = getLiveSessionTimeline(sessionKey)
    const runtime = useUIStore.getState().sessionRuntimeRunning ?? {}
    // Do NOT await worker getState on every hydrate — freezes switches when pool is busy.
    // Runtime map + live cache cover running badges.

    const runUI = resolveRunUI(sessionKey, {
      runtime,
      streamingAssistantId: live?.streamingAssistantId ?? null,
      optimisticPendingUserText: live?.optimisticPendingUserText ?? null,
      agentTurnBootstrapping: live?.agentTurnBootstrapping ?? false,
      workerSessionFile: sessionKey,
      workerStatus:
        runtime[sessionKey] ||
        Object.entries(runtime).some(([k, v]) => v && sessionFilesEqual(k, sessionKey))
          ? 'running'
          : 'idle',
    })

    const next: SessionView = {
      sessionKey,
      sessionId: sessionId ?? existing?.sessionId ?? null,
      items: cloneItems(merged),
      historyTotal: Math.max(hist.totalCount, merged.length),
      historyLoaded: Math.min(Math.max(hist.totalCount, merged.length), Math.max(merged.length, projected.length)),
      runUI,
      streamingAssistantId: live?.streamingAssistantId ?? null,
      optimisticPendingUserText: live?.optimisticPendingUserText ?? null,
      agentTurnBootstrapping: live?.agentTurnBootstrapping ?? false,
      pendingSteering: live?.pendingSteering ? [...live.pendingSteering] : [],
      pendingFollowUp: live?.pendingFollowUp ? [...live.pendingFollowUp] : [],
      phase: 'ready',
      lastFocusedAt: Date.now(),
      sessionMeta: hist.sessionMeta,
    }
    views.set(sessionKey, next)

    if (sessionFilesEqual(focusKey, sessionKey)) {
      bindViewToUiStore(next)
      useUIStore.getState().setHistoryLoading(false)
      // Non-blocking: composer meta / pending bind must not delay timeline paint
      void applyComposerDisplayMeta(hist.sessionMeta)
      void ipcClient.invoke('session.setPendingBind', { sessionFile: sessionKey }).catch(() => {})
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
