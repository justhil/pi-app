import type { AppEvent } from '@shared/app-events'
import {
  applyBackgroundAppEventToLiveTimeline,
  getLiveSessionTimeline,
} from '@renderer/lib/live-session-timeline-cache'
import { patchSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { useUIStore } from '@renderer/stores/ui-store'

/** Session key for runtime map / background cache — event.sessionFile only. */
export function eventSessionFile(event: AppEvent): string | null {
  if ('sessionFile' in event && typeof (event as { sessionFile?: string }).sessionFile === 'string') {
    return (event as { sessionFile?: string }).sessionFile || null
  }
  return null
}

/**
 * Apply a background (non-visible session) AppEvent to live cache + side chrome.
 * Stream text deltas are rAF-batched in the live cache; structural events patch the view.
 */
export function applyBackgroundAppEvent(event: AppEvent): void {
  const cacheFile = eventSessionFile(event)
  if (!cacheFile) return

  // 后台会话的压缩也要同步会话级压缩状态：否则 A 的 start 转后台后
  // end 也走这里，前台标志永远清不掉，切回 A 时错显压缩中
  if (event.type === 'compaction') {
    useUIStore.getState().setCompactingSession(cacheFile, event.phase === 'start')
  }

  applyBackgroundAppEventToLiveTimeline(cacheFile, event)

  const isStreamDelta =
    event.type === 'message' && event.phase === 'delta' && event.role === 'assistant'
  if (!isStreamDelta) {
    const snap = getLiveSessionTimeline(cacheFile)
    if (snap) {
      patchSessionTimelineView(cacheFile, {
        sessionId: snap.sessionId,
        tail: snap.timelineItems,
        streamingAssistantId: snap.streamingAssistantId,
        runState: snap.runState,
        pendingSteering: snap.pendingSteering,
        pendingFollowUp: snap.pendingFollowUp,
        optimisticPendingUserText: snap.optimisticPendingUserText,
        agentTurnBootstrapping: snap.agentTurnBootstrapping,
      })
    }
  }

  if (event.type !== 'run') return
  const running = event.phase === 'running' || event.phase === 'started'
  useUIStore.getState().setSessionRuntimeRunning(cacheFile, running)
  if (!running && (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled')) {
    void import('@renderer/lib/desktop-alerts').then(({ signalDesktopAlert }) => {
      void signalDesktopAlert('run_idle', {
        title: 'pi Desktop · 后台会话结束',
        body: '有会话在后台运行结束',
        background: true,
      })
    })
  }
}
