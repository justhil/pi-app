import { ipcClient } from '@renderer/lib/ipc-client'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'
import {
  clearSessionHistoryCache,
  fetchSessionHistoryTail,
  type GetMessagesResult,
} from '@renderer/lib/session-history'

const RETRY_DELAYS_MS = [0, 80, 200, 450, 900]

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export class SessionHistoryNavStaleError extends Error {
  constructor() {
    super('session navigation stale')
    this.name = 'SessionHistoryNavStaleError'
  }
}

function checkNav(navToken?: number): void {
  if (navToken != null && !assertSessionNavigation(navToken)) {
    throw new SessionHistoryNavStaleError()
  }
}

/** 切换/刷新会话：磁盘优先拉 JSONL 时间线；空读与 total 不一致时退避重试。不启动 Worker。 */
export async function loadSessionHistoryWithRetry(
  sessionFile: string,
  opts?: {
    navToken?: number
    bindPending?: boolean
    alignWorkerOnRetry?: boolean
    /** Kept for call-site compatibility; history is always disk-first. */
    workerReady?: boolean
  },
): Promise<GetMessagesResult> {
  const bindPending = opts?.bindPending !== false
  /** 默认 false：重试时勿 session.prepare/loadSession，避免切预览会话时卸掉后台仍在跑的 Worker 绑定 */
  const alignWorkerOnRetry = opts?.alignWorkerOnRetry === true

  checkNav(opts?.navToken)

  if (bindPending) {
    await ipcClient.invoke('session.setPendingBind', { sessionFile }).catch(() => {})
  }

  clearSessionHistoryCache(sessionFile)

  let last: GetMessagesResult = { items: [], totalCount: 0 }

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    checkNav(opts?.navToken)
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay > 0) await sleep(delay)

    if (alignWorkerOnRetry && attempt >= 2) {
      const prepared = await ipcClient.invoke('session.prepare', { sessionFile }).catch(() => null)
      if (prepared?.bound) {
        const { applyWorkerBoundModelDisplay } = await import('@renderer/lib/session-display-meta')
        applyWorkerBoundModelDisplay({
          model: prepared.model,
          thinkingLevel: prepared.thinkingLevel,
          modelFallbackMessage: prepared.modelFallbackMessage,
        })
      }
      clearSessionHistoryCache(sessionFile)
    }

    last = await fetchSessionHistoryTail(sessionFile, undefined, { bypassCache: true })

    if (last.error) {
      if (attempt >= RETRY_DELAYS_MS.length - 1) return last
      continue
    }

    if (last.items.length > 0) return last

    const total = last.totalCount ?? 0
    if (total === 0) {
      if (attempt >= 1) return last
      continue
    }

    // totalCount > 0 但 items 为空：Worker/解析竞态，继续重试
  }

  return last
}