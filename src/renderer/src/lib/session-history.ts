import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export interface GetMessagesResult {
  items: unknown[]
  sourceCount: number
  totalCount: number
  sessionMeta?: { model?: string; thinkingLevel?: string }
  error?: string
}

const sliceCache = new Map<
  string,
  {
    sourceCount: number
    totalCount: number
    items: unknown[]
    at: number
    sessionMeta?: GetMessagesResult['sessionMeta']
  }
>()
const SLICE_TTL_MS = 120_000
const INITIAL_TAIL = 80
const PAGE = 80

function activeWorkspace(): string | undefined {
  return useUIStore.getState().currentWorkspace || undefined
}

function cacheKey(sessionFile: string, offset: number, limit: number) {
  return `${sessionFile}|${offset}|${limit}`
}

export async function fetchSessionHistoryTail(
  sessionFile: string,
  limit = INITIAL_TAIL,
  opts?: { bypassCache?: boolean; leafId?: string | null },
): Promise<GetMessagesResult> {
  const leafSuffix = opts?.leafId === undefined ? '' : `|leaf:${opts.leafId ?? 'null'}`
  const key = cacheKey(sessionFile, 0, limit) + leafSuffix
  if (!opts?.bypassCache) {
    const hit = sliceCache.get(key)
    if (hit && Date.now() - hit.at < SLICE_TTL_MS) {
      return {
        items: hit.items,
        sourceCount: hit.sourceCount,
        totalCount: hit.totalCount,
        sessionMeta: hit.sessionMeta,
      }
    }
  }
  const res = await ipcClient.invoke('session.getMessages', {
    sessionFile,
    workspaceId: activeWorkspace(),
    offset: 0,
    limit,
    ...(opts?.leafId !== undefined ? { leafId: opts.leafId } : {}),
  })
  const items = res?.items || []
  const sourceCount =
    typeof (res as { sourceCount?: number })?.sourceCount === 'number'
      ? (res as { sourceCount: number }).sourceCount
      : items.length
  const totalCount = typeof res?.totalCount === 'number' ? res.totalCount : sourceCount
  const sessionMeta = res?.sessionMeta
  const err = (res as { error?: string })?.error
  if (err) {
    return { items: [], sourceCount: 0, totalCount: 0, sessionMeta, error: err }
  }
  if (sourceCount > 0 || totalCount > 0) {
    sliceCache.set(key, { items, sourceCount, totalCount, at: Date.now(), sessionMeta })
  }
  return { items, sourceCount, totalCount, sessionMeta }
}

export async function fetchSessionHistoryOlder(
  sessionFile: string,
  offset: number,
  limit = PAGE,
): Promise<GetMessagesResult> {
  const key = cacheKey(sessionFile, offset, limit)
  const hit = sliceCache.get(key)
  if (hit && Date.now() - hit.at < SLICE_TTL_MS) {
    return { items: hit.items, sourceCount: hit.sourceCount, totalCount: hit.totalCount }
  }
  const res = await ipcClient.invoke('session.getMessages', {
    sessionFile,
    workspaceId: activeWorkspace(),
    offset,
    limit,
  })
  const items = res?.items || []
  const sourceCount =
    typeof (res as { sourceCount?: number })?.sourceCount === 'number'
      ? (res as { sourceCount: number }).sourceCount
      : items.length
  const totalCount = typeof res?.totalCount === 'number' ? res.totalCount : sourceCount
  const sessionMeta = res?.sessionMeta
  sliceCache.set(key, { items, sourceCount, totalCount, at: Date.now() })
  return { items, sourceCount, totalCount, sessionMeta }
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

/** Direct getMessages with leaf tip (used after rewind when cache is cleared). */
export async function getSessionMessagesFromDiskViaIpc(
  sessionFile: string,
  leafId?: string | null,
): Promise<GetMessagesResult> {
  const res = await ipcClient.invoke('session.getMessages', {
    sessionFile,
    workspaceId: activeWorkspace(),
    offset: 0,
    limit: 80,
    ...(leafId !== undefined ? { leafId } : {}),
  })
  const items = res?.items || []
  const sourceCount =
    typeof (res as { sourceCount?: number })?.sourceCount === 'number'
      ? (res as { sourceCount: number }).sourceCount
      : items.length
  const totalCount = typeof res?.totalCount === 'number' ? res.totalCount : sourceCount
  const sessionMeta = res?.sessionMeta
  const err = (res as { error?: string })?.error
  if (err) return { items: [], sourceCount: 0, totalCount: 0, sessionMeta, error: err }
  return { items, sourceCount, totalCount, sessionMeta }
}

export const SESSION_HISTORY_PAGE = PAGE