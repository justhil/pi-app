import type { RunState, TimelineItem } from '@renderer/stores/ui-store-types'
import type { TimelineSyncCursor } from '@shared/session-timeline-sync-plan'
import { projectTimelineItems } from '@shared/timeline-projection'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

function viewKey(sessionFile: string): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

export type SessionTimelineView = {
  sessionFile: string
  sessionId: string | null
  head: TimelineItem[]
  tail: TimelineItem[]
  cursor: TimelineSyncCursor
  streamingAssistantId: string | null
  runState: RunState
  pendingSteering: string[]
  pendingFollowUp: string[]
  optimisticPendingUserText: string | null
  agentTurnBootstrapping: boolean
  updatedAt: number
}

const views = new Map<string, SessionTimelineView>()

function emptyRunState(): RunState {
  return { status: 'idle', toolCount: 0, errorCount: 0 }
}

export function getSessionTimelineView(sessionFile: string): SessionTimelineView | null {
  const key = viewKey(sessionFile)
  const v = views.get(key)
  if (!v) return null
  return {
    ...v,
    head: v.head.map((i) => ({ ...i })),
    tail: v.tail.map((i) => ({ ...i })),
    pendingSteering: [...v.pendingSteering],
    pendingFollowUp: [...v.pendingFollowUp],
    runState: { ...v.runState },
  }
}

export function ensureSessionTimelineView(sessionFile: string, sessionId: string | null = null): SessionTimelineView {
  const key = viewKey(sessionFile)
  let v = views.get(key)
  if (!v) {
    v = {
      sessionFile: key,
      sessionId,
      head: [],
      tail: [],
      cursor: { totalCount: 0, loadedOffsetFromEnd: 0, loadedThroughEntryId: null },
      streamingAssistantId: null,
      runState: emptyRunState(),
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      updatedAt: Date.now(),
    }
    views.set(key, v)
  }
  if (sessionId != null) v.sessionId = sessionId
  return v
}

export function selectDisplayedTimeline(view: SessionTimelineView): TimelineItem[] {
  const merged = [...view.head, ...view.tail]
  return projectTimelineItems(merged) as TimelineItem[]
}

export function patchSessionTimelineView(
  sessionFile: string,
  patch: Partial<Omit<SessionTimelineView, 'sessionFile'>>,
): SessionTimelineView {
  const v = ensureSessionTimelineView(sessionFile, patch.sessionId ?? null)
  if (patch.head !== undefined) v.head = patch.head
  if (patch.tail !== undefined) v.tail = patch.tail
  if (patch.cursor !== undefined) v.cursor = patch.cursor
  if (patch.streamingAssistantId !== undefined) v.streamingAssistantId = patch.streamingAssistantId
  if (patch.runState !== undefined) v.runState = patch.runState
  if (patch.pendingSteering !== undefined) v.pendingSteering = patch.pendingSteering
  if (patch.pendingFollowUp !== undefined) v.pendingFollowUp = patch.pendingFollowUp
  if (patch.optimisticPendingUserText !== undefined) v.optimisticPendingUserText = patch.optimisticPendingUserText
  if (patch.agentTurnBootstrapping !== undefined) v.agentTurnBootstrapping = patch.agentTurnBootstrapping
  if (patch.sessionId !== undefined) v.sessionId = patch.sessionId
  v.updatedAt = Date.now()
  return v
}

export function clearSessionTimelineView(sessionFile?: string | null): void {
  if (sessionFile) views.delete(viewKey(sessionFile))
  else views.clear()
}