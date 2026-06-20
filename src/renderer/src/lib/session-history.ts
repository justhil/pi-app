import { ipcClient } from '@renderer/lib/ipc-client'

export interface GetMessagesResult {
  items: unknown[]
  totalCount: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
}

const sliceCache = new Map<string, { totalCount: number; items: unknown[]; at: number }>()
const SLICE_TTL_MS = 120_000
const INITIAL_TAIL = 80
const PAGE = 80

function cacheKey(sessionFile: string, offset: number, limit: number) {
  return `${sessionFile}|${offset}|${limit}`
}

export async function fetchSessionHistoryTail(
  sessionFile: string,
  limit = INITIAL_TAIL,
): Promise<GetMessagesResult> {
  const key = cacheKey(sessionFile, 0, limit)
  const hit = sliceCache.get(key)
  if (hit && Date.now() - hit.at < SLICE_TTL_MS) {
    return { items: hit.items, totalCount: hit.totalCount }
  }
  const res = await ipcClient.invoke('session.getMessages', { sessionFile, offset: 0, limit })
  const items = res?.items || []
  const totalCount = typeof res?.totalCount === 'number' ? res.totalCount : items.length
  const sessionMeta = res?.sessionMeta
  sliceCache.set(key, { items, totalCount, at: Date.now() })
  return { items, totalCount, sessionMeta }
}

export async function fetchSessionHistoryOlder(
  sessionFile: string,
  offset: number,
  limit = PAGE,
): Promise<GetMessagesResult> {
  const key = cacheKey(sessionFile, offset, limit)
  const hit = sliceCache.get(key)
  if (hit && Date.now() - hit.at < SLICE_TTL_MS) {
    return { items: hit.items, totalCount: hit.totalCount }
  }
  const res = await ipcClient.invoke('session.getMessages', { sessionFile, offset, limit })
  const items = res?.items || []
  const totalCount = typeof res?.totalCount === 'number' ? res.totalCount : items.length
  const sessionMeta = res?.sessionMeta
  sliceCache.set(key, { items, totalCount, at: Date.now() })
  return { items, totalCount, sessionMeta }
}

export function clearSessionHistoryCache(sessionFile?: string): void {
  if (!sessionFile) {
    sliceCache.clear()
    return
  }
  for (const k of sliceCache.keys()) {
    if (k.startsWith(sessionFile + '|')) sliceCache.delete(k)
  }
}

export const SESSION_HISTORY_PAGE = PAGE