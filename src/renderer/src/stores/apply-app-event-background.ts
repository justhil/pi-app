import type { AppEvent } from '@shared/app-events'
import { applyBackgroundAppEventToLiveTimeline } from '@renderer/lib/live-session-timeline-cache'
import { markSessionDiskAuthoritative } from '@renderer/lib/session-disk-authority'
import { applyExtensionWidgetEvent } from '@renderer/lib/extension-widget-cache'
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
  if (event.type === 'completion') {
    if (event.settled === true) useUIStore.getState().markSessionSettled(cacheFile)
    return
  }
  if (event.type === 'extension_widget') {
    applyExtensionWidgetEvent(event)
    return
  }

  // 后台会话的压缩也要同步会话级压缩状态：否则 A 的 start 转后台后
  // end 也走这里，前台标志永远清不掉，切回 A 时错显压缩中
  if (event.type === 'compaction') {
    useUIStore.getState().setCompactingSession(cacheFile, event.phase === 'start')
  }

  // The live cache is the only background timeline store; switch-back reads it directly.
  applyBackgroundAppEventToLiveTimeline(cacheFile, event)

  if (event.type !== 'run') return
  const running = event.phase === 'running' || event.phase === 'started'
  useUIStore.getState().setSessionRuntimeRunning(cacheFile, running)
  // The turn is persisted now; switch-back must re-read disk instead of trusting the live cache.
  if (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled') {
    markSessionDiskAuthoritative(cacheFile)
  }
}
