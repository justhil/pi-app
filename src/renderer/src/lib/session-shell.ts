/**
 * Conversation Session Shell — focus switch + disk hydrate over the per-session store.
 *
 * Each conversation's rows, run state and turn markers live in `sessionStates[key]` (see
 * doc/dev/per-session-state-design.md). Background events keep that entry current with the same
 * handlers as the visible session, so a switch only re-points the view; nothing is copied between
 * sessions or caches. The shell keeps only view bookkeeping (phase, focus time, disk meta).
 *
 * Product rules (locked):
 * - Cache hit: zero full-screen skeleton; the session's own rows paint immediately.
 * - Max 12 sessions keep rows in memory; running sessions are never evicted.
 * - Run UI authority: sessionRuntimeRunning / the session's own turn markers — never another
 *   session's run state.
 *
 * @see docs/dev/conversation-session-shell.md
 */
import { ipcClient } from '@renderer/lib/ipc-client'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'
import { fetchSessionHistoryTail } from '@renderer/lib/session-history'
import {
  clearSessionDiskAuthoritative,
  isSessionDiskAuthoritative,
} from '@renderer/lib/session-disk-authority'
import { sanitizeHistoryTimeline } from '@renderer/lib/timeline-dedupe'
import { projectTimelineItems } from '@shared/timeline-projection'
import {
  mergeLiveTimelineWithHistoryTail,
  spliceFreshDiskTail,
} from '@renderer/lib/merge-live-history-timeline'
import {
  applyLiveStreamingTextToMergedTimeline,
  resolveMergedStreamingAssistantId,
} from '@renderer/lib/streaming-timeline-preserve'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { reportVisibleSession } from '@renderer/lib/visible-session-report'
import { getSessionComposerWidget } from '@renderer/lib/extension-widget-cache'
import { useUIStore } from '@renderer/stores/ui-store'
import { patchSessionState } from '@renderer/stores/session-scope'
import type { SessionState } from '@renderer/stores/session-state'
import type { RunState, TimelineItem } from '@renderer/stores/ui-store-types'
import { flushAllStreamPendingSync } from '@renderer/stores/ui-store-stream'

/** Product default: max sessions holding rows in memory (running pinned separately). */
export const MAX_SESSION_VIEWS = 12

export type SessionRunUI = 'idle' | 'running' | 'failed'

export type SessionViewPhase = 'empty' | 'cached' | 'hydrating' | 'ready' | 'error'

/** Read model of one session for callers: its keyed state plus the shell's view bookkeeping. */
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

type ViewMeta = {
  sessionId: string | null
  phase: SessionViewPhase
  lastFocusedAt: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
}

const meta = new Map<string, ViewMeta>()
let focusKey: string | null = null

export function sessionKeyFromFile(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

function entryOf(sessionKey: string): SessionState | undefined {
  return useUIStore.getState().sessionStates[sessionKey]
}

function runtimeSaysRunning(sessionKey: string, runtime = useUIStore.getState().sessionRuntimeRunning ?? {}): boolean {
  if (runtime[sessionKey] === true) return true
  return Object.entries(runtime).some(([key, running]) => running && sessionFilesEqual(key, sessionKey))
}

/** The session's own turn is in flight (its markers, not the view's). */
function entryTurnActive(entry: SessionState | undefined): boolean {
  return (
    !!entry &&
    (entry.runState.status === 'running' ||
      entry.streamingAssistantId != null ||
      entry.optimisticPendingUserText != null ||
      entry.agentTurnBootstrapping)
  )
}

function sessionTurnActive(sessionKey: string): boolean {
  return runtimeSaysRunning(sessionKey) || entryTurnActive(entryOf(sessionKey))
}

function runUIOf(sessionKey: string, entry: SessionState | undefined): SessionRunUI {
  if (runtimeSaysRunning(sessionKey) || entryTurnActive(entry)) return 'running'
  return entry?.runState.status === 'failed' ? 'failed' : 'idle'
}

export function getFocusSessionKey(): string | null {
  return focusKey
}

export function clearSessionFocus(): void {
  focusKey = null
}

export function getSessionView(sessionFile: string | null | undefined): SessionView | null {
  const key = sessionKeyFromFile(sessionFile)
  if (!key) return null
  const entry = entryOf(key)
  const m = meta.get(key)
  if (!entry && !m) return null
  return {
    sessionKey: key,
    sessionId: m?.sessionId ?? entry?.workerLiveSnapshot.sessionId ?? null,
    items: entry?.timelineItems ?? [],
    historyTotal: entry?.historyTotalCount ?? 0,
    historyLoaded: entry?.historyLoadedCount ?? 0,
    runUI: runUIOf(key, entry),
    streamingAssistantId: entry?.streamingAssistantId ?? null,
    optimisticPendingUserText: entry?.optimisticPendingUserText ?? null,
    agentTurnBootstrapping: entry?.agentTurnBootstrapping ?? false,
    pendingSteering: entry?.pendingSteering ?? [],
    pendingFollowUp: entry?.pendingFollowUp ?? [],
    phase: m?.phase ?? ((entry?.timelineItems.length ?? 0) > 0 ? 'cached' : 'empty'),
    lastFocusedAt: m?.lastFocusedAt ?? 0,
    sessionMeta: m?.sessionMeta,
  }
}

/** Write into one session's state through the view read model's field names. */
export function patchSessionView(
  sessionFile: string,
  patch: Partial<Omit<SessionView, 'sessionKey'>>,
): void {
  const key = sessionKeyFromFile(sessionFile)
  if (!key) return
  const { items, historyTotal, historyLoaded, runUI, phase, lastFocusedAt, sessionId, sessionMeta, ...rest } = patch
  const state: Partial<SessionState> = { ...rest }
  if (items) state.timelineItems = items
  if (historyTotal != null) state.historyTotalCount = historyTotal
  if (historyLoaded != null) state.historyLoadedCount = historyLoaded
  if (runUI) {
    const runState = entryOf(key)?.runState
    if (runState && runState.status !== runUI) state.runState = { ...runState, status: runUI }
  }
  if (Object.keys(state).length > 0) patchSessionState(key, state)
  if (phase || lastFocusedAt != null || sessionId !== undefined || sessionMeta) {
    const m = meta.get(key) ?? { sessionId: null, phase: 'empty', lastFocusedAt: Date.now() }
    meta.set(key, {
      ...m,
      ...(phase ? { phase } : {}),
      ...(lastFocusedAt != null ? { lastFocusedAt } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(sessionMeta ? { sessionMeta } : {}),
    })
  }
}

export function listSessionViewKeys(): string[] {
  const states = useUIStore.getState().sessionStates
  return Object.keys(states).filter((key) => !key.startsWith('draft:') && states[key].timelineItems.length > 0)
}

/**
 * LRU eviction of rows held in memory; never drops a running or focused session. An evicted
 * session re-hydrates from disk the next time it is opened.
 */
export function evictSessionViewsIfNeeded(runtime?: Record<string, boolean>): void {
  const runtimeMap = runtime ?? useUIStore.getState().sessionRuntimeRunning ?? {}
  const keys = listSessionViewKeys()
  if (keys.length <= MAX_SESSION_VIEWS) return

  const candidates = keys
    .filter((key) => key !== focusKey && !runtimeSaysRunning(key, runtimeMap) && !entryTurnActive(entryOf(key)))
    .sort((a, b) => (meta.get(a)?.lastFocusedAt ?? 0) - (meta.get(b)?.lastFocusedAt ?? 0))

  let overflow = keys.length - MAX_SESSION_VIEWS
  for (const key of candidates) {
    if (overflow <= 0) break
    patchSessionState(key, { timelineItems: [], streamingAssistantId: null, historyTotalCount: 0, historyLoadedCount: 0 })
    meta.delete(key)
    overflow--
  }
}

/**
 * Before the view leaves a session: land its batched stream text and remember focus time. The
 * session's rows already live in its own entry, so there is nothing to copy.
 */
export function captureFocusFromUiStore(): void {
  const state = useUIStore.getState()
  const viewFile = state.historySessionFile
  if (!viewFile) return
  flushAllStreamPendingSync()
  const sessionKey = sessionKeyFromFile(viewFile)
  if (!sessionKey) return
  const m = meta.get(sessionKey)
  meta.set(sessionKey, {
    sessionId: state.currentSessionId ?? m?.sessionId ?? null,
    phase: m?.phase ?? (state.timelineItems.length > 0 ? 'cached' : 'empty'),
    lastFocusedAt: Date.now(),
    sessionMeta: m?.sessionMeta,
  })
  // Keep the runtime map honest while leaving a still-active turn.
  if (entryTurnActive(entryOf(sessionKey))) state.setSessionRuntimeRunning(sessionKey, true)
}

/**
 * Point the view at a session. Its rows, queue and turn markers come from its own entry; only the
 * run status is reconciled with the runtime map (a background turn may have started or ended
 * without a run event reaching this renderer, e.g. after a reload).
 */
export function bindViewToUiStore(view: SessionView): void {
  useUIStore.setState({ currentSessionId: view.sessionId, historySessionFile: view.sessionKey })
  const target = useUIStore.getState()
  const runUI = runUIOf(view.sessionKey, entryOf(view.sessionKey))
  const status: RunState['status'] = runUI
  if (runUI === 'running') target.setSessionRuntimeRunning(view.sessionKey, true)
  if (target.runState.status !== status) {
    target.setRunState(
      status === 'running'
        ? { status }
        : { status, activeTool: undefined, activeToolStatus: undefined, activeRunId: undefined },
    )
  }
  useUIStore.getState().setWorkerLiveSnapshot({
    sessionId: view.sessionId ?? target.workerLiveSnapshot.sessionId,
    sessionFile: view.sessionKey,
    status: runUI,
  })
}

/**
 * Sync focus pointer and paint the session's own rows immediately. Returns whether it had rows
 * (instant path).
 */
export function focusSessionSync(sessionId: string, sessionFile: string): {
  sessionKey: string
  instant: boolean
  view: SessionView
} {
  captureFocusFromUiStore()
  // Background sessions batch their stream text too; land it before painting the target.
  flushAllStreamPendingSync()

  const sessionKey = sessionKeyFromFile(sessionFile)
  focusKey = sessionKey

  const instant = (entryOf(sessionKey)?.timelineItems.length ?? 0) > 0
  const prior = meta.get(sessionKey)
  // Any non-empty session paints immediately — even if a previous hydrate left phase='hydrating'
  // (user switched away mid-fetch). Streaming switch-back must never stick on skeleton.
  const phase: SessionViewPhase =
    instant && prior?.phase !== 'ready' ? 'cached' : (prior?.phase ?? (instant ? 'cached' : 'empty'))
  meta.set(sessionKey, {
    sessionId: sessionId ?? prior?.sessionId ?? null,
    phase,
    lastFocusedAt: Date.now(),
    sessionMeta: prior?.sessionMeta,
  })

  // Set loading BEFORE bind so empty cold targets never paint one frame of "empty chat".
  useUIStore.getState().setHistoryLoading(!instant)
  const view = getSessionView(sessionKey)!
  bindViewToUiStore(view)
  useUIStore.getState().markSessionViewed(sessionFile)
  useUIStore.getState().setComposerWidget(getSessionComposerWidget(sessionFile))
  evictSessionViewsIfNeeded()
  reportVisibleSession(sessionFile)

  return { sessionKey, instant, view: getSessionView(sessionKey)! }
}

/** Disk tail merged with the session's own in-memory rows (live tail, optimistic rows). */
function mergeDiskWithSessionRows(diskProjected: TimelineItem[], entry: SessionState | undefined): TimelineItem[] {
  const rows = entry?.timelineItems ?? []
  if (rows.length === 0) return diskProjected
  let merged = mergeLiveTimelineWithHistoryTail(diskProjected, rows)
  merged = applyLiveStreamingTextToMergedTimeline(merged, rows, entry?.streamingAssistantId ?? null)
  return projectTimelineItems(merged) as TimelineItem[]
}

/**
 * Background / cold hydrate: read the disk tail and merge it into the session's own entry.
 * Cancelled via navToken. Works the same whether or not the session is visible.
 */
export async function hydrateSessionView(
  sessionFileOrKey: string,
  sessionId: string | null,
  navToken?: number,
  options?: { bindWorker?: boolean },
): Promise<void> {
  if (navToken != null && !assertSessionNavigation(navToken)) return
  const sessionKey = sessionKeyFromFile(sessionFileOrKey)

  const before = entryOf(sessionKey)
  const priorMeta = meta.get(sessionKey)
  const hadRows = (before?.timelineItems.length ?? 0) > 0
  meta.set(sessionKey, {
    sessionId: sessionId ?? priorMeta?.sessionId ?? null,
    phase: hadRows ? (priorMeta?.phase ?? 'cached') : 'hydrating',
    lastFocusedAt: priorMeta?.lastFocusedAt ?? Date.now(),
    sessionMeta: priorMeta?.sessionMeta,
  })

  const restorePhaseIfUnfinished = (): void => {
    // Never leave phase stuck as hydrating, or switch-back treats rows as a cold open.
    const current = meta.get(sessionKey)
    if (!current || current.phase !== 'hydrating') return
    const rows = entryOf(sessionKey)?.timelineItems.length ?? 0
    meta.set(sessionKey, { ...current, phase: rows > 0 ? 'cached' : priorMeta?.phase === 'ready' ? 'ready' : 'empty' })
  }
  const focused = (): boolean => sessionFilesEqual(focusKey, sessionKey)

  try {
    // A running turn can persist a fuller reply before its terminal event reaches us.
    // Disk-first IPC — never spawns a worker.
    const diskAuthoritative = isSessionDiskAuthoritative(sessionKey)
    const hist = await fetchSessionHistoryTail(sessionKey, 80, {
      bypassCache: !hadRows || diskAuthoritative || sessionTurnActive(sessionKey),
    })
    if (navToken != null && !assertSessionNavigation(navToken)) {
      restorePhaseIfUnfinished()
      return
    }

    if (hist.error) {
      const rows = entryOf(sessionKey)?.timelineItems.length ?? 0
      const m = meta.get(sessionKey)
      if (m) meta.set(sessionKey, { ...m, phase: rows > 0 ? 'cached' : 'error' })
      if (focused()) useUIStore.getState().setHistoryLoading(false)
      return
    }

    // Land batched stream text, then read the session's entry as it is *now* (events may have
    // appended rows during the fetch).
    flushAllStreamPendingSync()
    const entry = entryOf(sessionKey)
    const rows = entry?.timelineItems ?? []
    const diskItems = sanitizeHistoryTimeline(hist.items as TimelineItem[])
    const projected = projectTimelineItems(diskItems) as TimelineItem[]

    // Finished background turn: disk is authoritative for the tail (#99) — splice it in place of
    // whatever the session held, keeping its earlier loaded prefix. A turn that restarted
    // meanwhile (queued follow-up) keeps its live rows.
    const turnActive = sessionTurnActive(sessionKey)
    const reconciled = diskAuthoritative && !turnActive ? spliceFreshDiskTail(rows, projected) : null
    const merged = reconciled ? reconciled.items : mergeDiskWithSessionRows(projected, entry)

    const loadedFromDisk = reconciled
      ? reconciled.prefixCount > 0
        ? Math.min(
            hist.totalCount,
            Math.max(
              hist.sourceCount,
              (entry?.historyLoadedCount ?? 0) +
                Math.max(0, hist.totalCount - (entry?.historyTotalCount ?? hist.totalCount)),
            ),
          )
        : Math.min(hist.totalCount, hist.sourceCount)
      : Math.min(hist.totalCount, hist.sourceCount)
    // A view-jump reveal may have loaded far more history than this tail; never shrink the counter.
    const historyLoadedCount = reconciled
      ? loadedFromDisk
      : Math.max(loadedFromDisk, entry?.historyLoadedCount ?? 0)

    const streamingAssistantId = reconciled
      ? null
      : resolveMergedStreamingAssistantId(merged, rows, entry?.streamingAssistantId ?? null)

    patchSessionState(sessionKey, {
      timelineItems: merged,
      streamingAssistantId,
      historyTotalCount: hist.totalCount,
      historyLoadedCount,
    })
    if (turnActive) useUIStore.getState().setSessionRuntimeRunning(sessionKey, true)
    if (reconciled) clearSessionDiskAuthoritative(sessionKey)

    const m = meta.get(sessionKey)
    meta.set(sessionKey, {
      sessionId: sessionId ?? m?.sessionId ?? null,
      phase: focused() ? 'ready' : merged.length > 0 ? 'cached' : 'empty',
      lastFocusedAt: m?.lastFocusedAt ?? Date.now(),
      sessionMeta: hist.sessionMeta ?? m?.sessionMeta,
    })

    if (focused()) {
      bindViewToUiStore(getSessionView(sessionKey)!)
      if (options?.bindWorker !== false) {
        // Normal conversations bind before showing composer meta/context.
        await ipcClient.invoke('session.setPendingBind', { sessionFile: sessionKey }).catch(() => {})
      }
      useUIStore.getState().setHistoryLoading(false)
      void applyComposerDisplayMeta(hist.sessionMeta)
    }
  } catch (error) {
    console.error('[session-shell] hydrate failed:', error)
    restorePhaseIfUnfinished()
    if (navToken != null && !assertSessionNavigation(navToken)) return
    if (focused()) useUIStore.getState().setHistoryLoading(false)
  }
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

/** Test helper: forget every session's rows and the view bookkeeping */
export function clearSessionShellForTests(): void {
  meta.clear()
  focusKey = null
  clearSessionDiskAuthoritative()
  useUIStore.setState({ sessionStates: {}, viewSessionKey: null })
}
