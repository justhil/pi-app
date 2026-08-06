import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

/**
 * 外部更新：CLI 等非 app worker 对当前查看会话 JSONL 的追加。
 * 视图层只读合并磁盘新尾部（不改 worker 内存态）；无新增时视为 app 自身写入，不亮角标。
 */
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
      showNonMessageEntries: store.showNonMessageEntries,
    })) as typeof res
  } catch {
    return
  }
  const newItems = (res?.items || []) as TimelineItem[]
  if (!Array.isArray(newItems) || newItems.length === 0) return

  const { sanitizeHistoryTimeline, dedupeAdjacentUserMessages } = await import(
    '@renderer/lib/timeline-dedupe'
  )
  useUIStore.setState((s) => {
    if (!s.historySessionFile || !sessionFilesEqual(s.historySessionFile, sessionFile)) return {}
    const cleaned = sanitizeHistoryTimeline(newItems)
    // 尾部页会包含已加载的历史：只保留视图里还没有的条目，避免重复追加。
    const existingIds = new Set(s.timelineItems.map((i) => i.sessionEntryId ?? i.id))
    const fresh = cleaned.filter((i) => !existingIds.has(i.sessionEntryId ?? i.id))
    const merged = dedupeAdjacentUserMessages([...s.timelineItems, ...fresh])
    const added = merged.length - s.timelineItems.length
    if (added <= 0) return {}
    return {
      timelineItems: merged,
      historyTotalCount: typeof res.totalCount === 'number' ? res.totalCount : s.historyTotalCount,
      historyLoadedCount: s.historyLoadedCount + added,
      externalUpdateFor: sessionFile,
    }
  })
}

export function isCurrentSessionExternallyUpdated(): boolean {
  const s = useUIStore.getState()
  return !!s.externalUpdateFor && !!s.historySessionFile && sessionFilesEqual(s.externalUpdateFor, s.historySessionFile)
}
