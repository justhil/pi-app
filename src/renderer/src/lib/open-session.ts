import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { loadSessionHistoryWithRetry, SessionHistoryNavStaleError } from '@renderer/lib/load-session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'
import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import { getLiveSessionTimeline } from '@renderer/lib/live-session-timeline-cache'
import { mergeLiveTimelineWithHistoryTail } from '@renderer/lib/merge-live-history-timeline'
import { applyLiveStreamingTextToMergedTimeline } from '@renderer/lib/streaming-timeline-preserve'
import { loadAuthoritativeForOpen } from '@renderer/lib/session-timeline-sync'
import { mergeLiveActiveSessionDisplay } from '@renderer/lib/open-session-live-restore'
import { isLiveSessionTurnActive, mergeLiveViewRunState } from '@renderer/lib/live-session-restore'
import { applyLiveSnapshotToView, fetchWorkerLiveSnapshot, syncViewRunStateFromWorkerSnapshot } from '@renderer/lib/session-worker-sync'
import { patchSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { projectTimelineItems } from '@shared/timeline-projection'

/**
 * 切换会话：时间线 tail 预览 + pendingBind；Worker loadSession 在首条 prompt / steer / followUp 或 session.navigateTree。
 */
export async function openSessionIntoWorker(
  sessionId: string,
  sessionFile?: string,
  navToken?: number,
  opts?: { workerReady?: boolean },
): Promise<void> {
  captureVisibleLiveSessionTimeline()
  const store = useUIStore.getState()

  if (!sessionFile) {
    store.setCurrentSession(sessionId)
    store.clearTimeline()
    store.clearFileChanges()
    useExtensionUIStore.getState().resetForSessionContext()
    store.setHistoryMeta(0, 0, null)
    store.loadHistoryItems([])
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
    if (navToken != null && !assertSessionNavigation(navToken)) return
    await applyComposerDisplayMeta()
    void refreshSessionTree(null)
    return
  }

  // 不 session.prepare：避免切换时 resourceLoader + createAgentSession 全量绑定
  store.setCurrentSession(sessionId)
  store.clearTimeline()
  store.clearFileChanges()
  useExtensionUIStore.getState().resetForSessionContext()
  const snapEarly = await fetchWorkerLiveSnapshot().catch(() => null)
  if (snapEarly) store.setWorkerLiveSnapshot(snapEarly)
  const workerSnap = snapEarly ?? store.workerLiveSnapshot
  const boundToWorker = !!sessionFile && workerSnap.sessionFile === sessionFile
  const live = sessionFile ? getLiveSessionTimeline(sessionFile) : null
  const liveTurnActive = sessionFile ? isLiveSessionTurnActive(sessionFile, live, snapEarly) : false
  if (live && liveTurnActive) {
    if (navToken != null && !assertSessionNavigation(navToken)) return
    const auth = await loadAuthoritativeForOpen(sessionFile).catch(() => null)
    if (navToken != null && !assertSessionNavigation(navToken)) return
    const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
    const diskItems = sanitizeHistoryTimeline(
      (auth?.items ?? []) as import('@renderer/stores/ui-store-types').TimelineItem[],
    )
    const totalCount = auth?.totalCount ?? diskItems.length
    const cursor = auth?.cursor ?? { totalCount, loadedOffsetFromEnd: diskItems.length, loadedThroughEntryId: null }
    const { displayed, mergedStreamId, historyLoadedCount, totalCount: totalAfter } = mergeLiveActiveSessionDisplay({
      diskItems,
      live,
      totalCount,
      cursor,
    })
    useUIStore.setState({
      timelineItems: displayed,
      streamingAssistantId: mergedStreamId,
      optimisticPendingUserText: live.optimisticPendingUserText,
      agentTurnBootstrapping: live.agentTurnBootstrapping,
      pendingSteering: live.pendingSteering,
      pendingFollowUp: live.pendingFollowUp,
    })
    patchSessionTimelineView(sessionFile, {
      sessionId,
      tail: displayed,
      cursor: { ...cursor, totalCount, loadedOffsetFromEnd: Math.max(cursor.loadedOffsetFromEnd, historyLoadedCount) },
    })
    store.setRunState(mergeLiveViewRunState(sessionFile, live, snapEarly))
    store.setHistoryMeta(totalAfter, historyLoadedCount, sessionFile)
    store.setHistoryLoading(false)
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
    void refreshSessionTree(sessionFile)
    return
  }
  if (boundToWorker && workerSnap.status === 'running') {
    syncViewRunStateFromWorkerSnapshot(sessionFile, workerSnap, (p) => store.setRunState(p))
  } else if (!liveTurnActive) {
    store.setRunState({ status: 'idle', activeTool: undefined, activeToolStatus: undefined })
  }
  if (!store.historyLoading) {
    store.setHistoryLoading(true)
  }
  store.setHistoryMeta(0, 0, sessionFile)

  try {
    const hist = await loadSessionHistoryWithRetry(sessionFile, {
      navToken,
      bindPending: true,
      alignWorkerOnRetry: false,
      workerReady: opts?.workerReady,
    })
    if (navToken != null && !assertSessionNavigation(navToken)) {
      store.setHistoryLoading(false)
      return
    }
    const { items, totalCount, sessionMeta } = hist
    const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
    const diskItems = sanitizeHistoryTimeline(items as import('@renderer/stores/ui-store-types').TimelineItem[])
    const liveAfter = getLiveSessionTimeline(sessionFile)
    let merged = liveAfter
      ? mergeLiveTimelineWithHistoryTail(diskItems, liveAfter.timelineItems)
      : diskItems
    if (liveAfter) {
      merged = applyLiveStreamingTextToMergedTimeline(
        merged,
        liveAfter.timelineItems,
        liveAfter.streamingAssistantId,
      )
    }
    const displayed = projectTimelineItems(merged)
    store.loadHistoryItems(displayed)
    patchSessionTimelineView(sessionFile, {
      sessionId,
      head: [],
      tail: displayed,
      cursor: { totalCount, loadedOffsetFromEnd: Math.min(totalCount, displayed.length), loadedThroughEntryId: null },
    })
    if (liveAfter) {
      useUIStore.setState({
        streamingAssistantId: liveAfter.streamingAssistantId,
        optimisticPendingUserText: liveAfter.optimisticPendingUserText,
        agentTurnBootstrapping: liveAfter.agentTurnBootstrapping,
        pendingSteering: liveAfter.pendingSteering,
        pendingFollowUp: liveAfter.pendingFollowUp,
      })
      const mergedRun = mergeLiveViewRunState(sessionFile, liveAfter, store.workerLiveSnapshot)
      if (mergedRun.status === 'running' || liveAfter.streamingAssistantId != null) {
        store.setRunState({
          ...store.runState,
          ...mergedRun,
          status: mergedRun.status === 'running' ? 'running' : store.runState.status,
        })
      }
    }
    store.setHistoryMeta(totalCount, merged.length, sessionFile)
    await applyComposerDisplayMeta(sessionMeta)
    void refreshSessionTree(sessionFile)
  } catch (e) {
    if (e instanceof SessionHistoryNavStaleError) {
      store.setHistoryLoading(false)
      return
    }
    console.error('[openSession] failed:', e)
    if (navToken != null && !assertSessionNavigation(navToken)) {
      store.setHistoryLoading(false)
      return
    }
    store.loadHistoryItems([])
    store.setHistoryMeta(0, 0, sessionFile)
    await applyComposerDisplayMeta()
    void refreshSessionTree(sessionFile)
  } finally {
    if (navToken == null || assertSessionNavigation(navToken)) {
      store.setHistoryLoading(false)
      const snap = await fetchWorkerLiveSnapshot().catch(() => null)
      if (snap) applyLiveSnapshotToView(store.historySessionFile, snap, store)
    }
  }
}

/** @deprecated 使用 afterPromptSent；保留别名避免旧引用 */
export async function onWorkerSessionBound(): Promise<void> {
  const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
  await afterPromptSent()
}