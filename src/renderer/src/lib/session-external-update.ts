import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

/**
 * 外部更新：CLI 等非 app worker 对当前查看会话 JSONL 的追加。
 * 视图层只读合并磁盘新尾部（不改 worker 内存态）。
 *
 * 错误策略（与 CONTEXT.md 决策一致）：
 * - watcher/轮询通知只是"文件变了"，不等于有外部 CLI 在写。
 * - 首次读取失败静默（有限重试：0ms / 500ms / 2s），不误报"外部同步异常"。
 * - 只有当前会话已确认外部活动（成功合并过新增，5s 窗口内）后连续失败，才亮错误。
 * - error 状态带 10s 慢速自检，成功后自动恢复。
 * - 切换会话立即重置（代际 token 使旧会话的在飞读取全部失效）。
 */

const EXTERNAL_SYNC_IDLE_MS = 5000
const RETRY_DELAYS_MS = [0, 500, 2000]
const ERROR_REPROBE_MS = 10_000

/** 会话切换代际：旧代际的异步结果一律丢弃。 */
let generation = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
let errorProbeTimer: ReturnType<typeof setInterval> | null = null
let probeInFlight = false

type PendingRead = { pendingAgain: boolean }

const inFlight = new Map<string, PendingRead>()

function clearTimers(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (errorProbeTimer) {
    clearInterval(errorProbeTimer)
    errorProbeTimer = null
  }
  probeInFlight = false
}

/** 切换会话 / 工作区 / 空白会话时调用：重置指示器并作废所有在飞读取。 */
export function resetExternalSessionSync(): void {
  generation++
  clearTimers()
  inFlight.clear()
  const store = useUIStore.getState()
  if (store.externalSyncPhase !== 'idle') store.setExternalSyncPhase('idle')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 当前视图仍是该会话、未发生代际变更、且 app 未在跑该会话。 */
function stillCurrent(g: number, sessionFile: string): boolean {
  if (g !== generation) return false
  const store = useUIStore.getState()
  if (!store.historySessionFile || !sessionFilesEqual(store.historySessionFile, sessionFile)) {
    return false
  }
  return !composerTurnActive({
    historySessionFile: store.historySessionFile,
    workerLiveSnapshot: store.workerLiveSnapshot,
    sessionRuntimeRunning: store.sessionRuntimeRunning,
  })
}

function markExternalSyncActive(g: number, sessionFile: string): void {
  if (!stillCurrent(g, sessionFile)) return
  const store = useUIStore.getState()
  store.setExternalSyncPhase('active')
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (g !== generation) return
    // 仅当期间没有新的外部写入时转为 idle（本轮对话结束）
    if (useUIStore.getState().externalSyncPhase === 'active') {
      useUIStore.getState().setExternalSyncPhase('idle')
    }
  }, EXTERNAL_SYNC_IDLE_MS)
}

function markExternalSyncError(g: number, sessionFile: string): void {
  if (!stillCurrent(g, sessionFile)) return
  const store = useUIStore.getState()
  // 只有"已确认外部活动"窗口内的连续失败才亮错误（未确认来源的失败保持静默）
  if (store.externalSyncPhase !== 'active') return
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  store.setExternalSyncPhase('error')
  if (errorProbeTimer) clearInterval(errorProbeTimer)
  errorProbeTimer = setInterval(() => {
    void reprobeErrorOnce(g, sessionFile)
  }, ERROR_REPROBE_MS)
}

function stopErrorProbe(): void {
  if (errorProbeTimer) {
    clearInterval(errorProbeTimer)
    errorProbeTimer = null
  }
}

/** error 慢速自检：单次读取，成功后自动恢复（无新增 → idle；有新增 → active）。 */
async function reprobeErrorOnce(g: number, sessionFile: string): Promise<void> {
  if (probeInFlight || !stillCurrent(g, sessionFile)) return
  if (useUIStore.getState().externalSyncPhase !== 'error') {
    stopErrorProbe()
    return
  }
  probeInFlight = true
  try {
    const res = await readTail(sessionFile)
    if (res.error || !stillCurrent(g, sessionFile)) return
    const merged = await mergeTailIntoView(sessionFile, res)
    stopErrorProbe()
    if (merged) markExternalSyncActive(g, sessionFile)
    else useUIStore.getState().setExternalSyncPhase('idle')
  } finally {
    probeInFlight = false
  }
}

type TailRead = {
  error?: string
  items: TimelineItem[]
  totalCount?: number
}

async function readTail(sessionFile: string): Promise<TailRead> {
  try {
    // offset 语义是"从尾部倒数跳过 N 条"（倒序分页）；直接拉尾部页（最多 500 条）。
    // IPC schema 要求 limit >= 1（上游新增校验），500 即 handler 内部封顶值。
    const store = useUIStore.getState()
    const res = (await ipcClient.invoke('session.getMessages', {
      sessionFile,
      workspaceId: store.currentWorkspace || undefined,
      offset: 0,
      limit: 500,
    })) as { items?: unknown[]; totalCount?: number; error?: string }
    return {
      error: res?.error,
      items: Array.isArray(res?.items) ? (res.items as TimelineItem[]) : [],
      totalCount: res?.totalCount,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), items: [] }
  }
}

/** 合并磁盘尾部进视图；返回是否有新增。zustand setState 返回 undefined，用 updater 内捕获。 */
async function mergeTailIntoView(sessionFile: string, res: TailRead): Promise<boolean> {
  if (res.error || res.items.length === 0) return false
  const { sanitizeHistoryTimeline, dedupeAdjacentUserMessages } = await import(
    '@renderer/lib/timeline-dedupe'
  )
  let hasNewItems = false
  useUIStore.setState((s) => {
    if (!s.historySessionFile || !sessionFilesEqual(s.historySessionFile, sessionFile)) return {}
    const cleaned = sanitizeHistoryTimeline(res.items)
    // 以视图尾部最后一个持久化条目为锚点，只追加锚点之后的磁盘条目
    // （防止把尚未分页加载的更早历史误当新增追加到尾部）
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
  return hasNewItems
}

/** 单次通知的完整读取流程：有限重试，失败按"是否已确认外部活动"决定静默或报错。 */
async function runSyncRead(sessionFile: string): Promise<void> {
  const g = generation
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt])
    if (!stillCurrent(g, sessionFile)) return

    const res = await readTail(sessionFile)
    if (!stillCurrent(g, sessionFile)) return

    if (res.error) {
      if (attempt === RETRY_DELAYS_MS.length - 1) {
        console.warn('[external-sync] read failed after retries:', res.error)
        // 已确认外部活动窗口内的连续失败 → 亮错误；否则静默等待下一次事件/轮询
        markExternalSyncError(g, sessionFile)
      }
      continue
    }

    const merged = await mergeTailIntoView(sessionFile, res)
    if (!stillCurrent(g, sessionFile)) return
    if (merged) {
      markExternalSyncActive(g, sessionFile)
    } else if (useUIStore.getState().externalSyncPhase === 'error') {
      // 读取成功且无新增：解除错误（自检成功 / 新事件确认视图已最新）
      stopErrorProbe()
      useUIStore.getState().setExternalSyncPhase('idle')
    }
    return
  }
}

export async function handleSessionExternalUpdate(sessionFile: string): Promise<void> {
  const store = useUIStore.getState()
  const viewFile = store.historySessionFile
  if (!viewFile || !sessionFilesEqual(viewFile, sessionFile)) return

  // app worker 正在跑本会话时，文件写入者是 app 自己，跳过
  if (
    composerTurnActive({
      historySessionFile: viewFile,
      workerLiveSnapshot: store.workerLiveSnapshot,
      sessionRuntimeRunning: store.sessionRuntimeRunning,
    })
  ) {
    return
  }

  // 合并同一会话的并发通知：在飞时只挂起一次后续读取
  const key = normalizeSessionFileKey(sessionFile) || sessionFile
  const existing = inFlight.get(key)
  if (existing) {
    existing.pendingAgain = true
    return
  }
  const entry: PendingRead = { pendingAgain: false }
  inFlight.set(key, entry)
  try {
    do {
      entry.pendingAgain = false
      await runSyncRead(sessionFile)
    } while (entry.pendingAgain && stillCurrent(generation, sessionFile))
  } finally {
    inFlight.delete(key)
  }
}
