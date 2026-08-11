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
      sessionRuntimeRunning: store.sessionRuntimeRunning,
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
      workspaceId: store.currentWorkspace || undefined,
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
    // 视图可能只加载了尾部若干条（分页未拉满）：不能按“视图里没有的 id 都是新增”过滤，
    // 否则磁盘页里更早、尚未加载的历史会被误追加到尾部并推高 historyLoadedCount，
    // 永久阻断旧历史分页。以视图尾部最后一个持久化条目为锚点，只追加锚点之后的磁盘条目。
    const existingIds = new Set(s.timelineItems.map((i) => i.sessionEntryId ?? i.id))
    let anchorId: string | null = null
    for (let i = s.timelineItems.length - 1; i >= 0; i--) {
      const eid = s.timelineItems[i].sessionEntryId
      // 真实 JSONL entry id 才有资格当锚点（投影的 hist-* 不是持久化条目）
      if (eid && !String(eid).startsWith('hist-')) {
        anchorId = eid
        break
      }
    }
    const anchorIdx = anchorId ? cleaned.findIndex((i) => (i.sessionEntryId ?? i.id) === anchorId) : -1
    // 锚点不在磁盘尾部页里（如页被 500 条截断、锚点更早）：保守不追加，避免乱序
    if (anchorIdx === -1) return {}
    const fresh = cleaned
      .slice(anchorIdx + 1)
      .filter((i) => !existingIds.has(i.sessionEntryId ?? i.id))
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
