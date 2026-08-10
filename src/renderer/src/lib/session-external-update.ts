import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

/**
 * 外部更新：CLI 等非 app worker 对当前查看会话 JSONL 的追加。
 * 视图层只读合并磁盘新尾部（不改 worker 内存态）。同步状态驱动三态指示器：
 * active（外部对话进行中，绿色动效）→ 5s 无外部写入后 idle（本轮结束隐藏）；
 * IPC 异常 → error（橙色/红色，可点击重试）。
 */

const EXTERNAL_SYNC_IDLE_MS = 5000

let idleTimer: ReturnType<typeof setTimeout> | null = null

function markExternalSyncActive(): void {
  const setPhase = useUIStore.getState().setExternalSyncPhase
  setPhase('active')
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    // 仅当期间没有新的外部写入时转为 idle（本轮对话结束）
    if (useUIStore.getState().externalSyncPhase === 'active') {
      useUIStore.getState().setExternalSyncPhase('idle')
    }
  }, EXTERNAL_SYNC_IDLE_MS)
}

export function markExternalSyncError(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  useUIStore.getState().setExternalSyncPhase('error')
}

export async function handleSessionExternalUpdate(sessionFile: string): Promise<void> {
  const store = useUIStore.getState()
  const viewFile = store.historySessionFile
  if (!viewFile || !sessionFilesEqual(viewFile, sessionFile)) return

  // app worker 正在跑本会话时，文件写入者是 app 自己，跳过
  const { composerTurnActive } = await import('@renderer/lib/session-worker-sync')
  if (
    composerTurnActive({
      historySessionFile: store.historySessionFile,
      workerLiveSnapshot: store.workerLiveSnapshot,
      runState: store.runState,
      streamingAssistantId: store.streamingAssistantId,
      optimisticPendingUserText: store.optimisticPendingUserText,
      sessionRuntimeRunning: store.sessionRuntimeRunning,
      agentTurnBootstrapping: store.agentTurnBootstrapping,
    })
  ) {
    return
  }

  let res: { items?: unknown[]; totalCount?: number; error?: string }
  try {
    // offset 语义是“从尾部倒数跳过 N 条”（倒序分页），不能拿旧总数当 offset；
    // 直接拉尾部页（含全部或最近 500 条），再按 id 过滤出真正的新增尾部。
    res = (await ipcClient.invoke('session.getMessages', {
      sessionFile,
      offset: 0,
      limit: 0,
    })) as typeof res
  } catch {
    markExternalSyncError()
    return
  }
  const newItems = (res?.items || []) as TimelineItem[]
  if (!Array.isArray(newItems) || newItems.length === 0) {
    if (res?.error) markExternalSyncError()
    return
  }

  const { sanitizeHistoryTimeline, dedupeAdjacentUserMessages } = await import(
    '@renderer/lib/timeline-dedupe'
  )
  // zustand setState 返回 undefined，不能靠返回值判断是否新增；用 updater 内捕获
  let hasNewItems = false
  useUIStore.setState((s) => {
    if (!s.historySessionFile || !sessionFilesEqual(s.historySessionFile, sessionFile)) return {}
    const cleaned = sanitizeHistoryTimeline(newItems)
    // 尾部页会包含已加载的历史：只保留视图里还没有的条目，避免重复追加。
    const existingIds = new Set(s.timelineItems.map((i) => i.sessionEntryId ?? i.id))
    const fresh = cleaned.filter((i) => !existingIds.has(i.sessionEntryId ?? i.id))
    const merged = dedupeAdjacentUserMessages([...s.timelineItems, ...fresh])
    const addedCount = merged.length - s.timelineItems.length
    if (addedCount <= 0) return {}
    hasNewItems = true
    return {
      timelineItems: merged,
      historyTotalCount: typeof res.totalCount === 'number' ? res.totalCount : s.historyTotalCount,
      historyLoadedCount: s.historyLoadedCount + addedCount,
    }
  })
  if (hasNewItems) markExternalSyncActive()
}
