import { pathToFileURL, fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import { errorMessage } from './error-message'

export type SessionTimelineMeta = { model?: string; thinkingLevel?: string }

export type SessionTouchedFile = {
  path: string
  source: 'edit' | 'write'
  changeType: 'created' | 'modified'
}

export type SessionTimelinePage = {
  items: Array<Record<string, unknown>>
  totalCount: number
  sessionMeta?: SessionTimelineMeta
  touchedFiles?: SessionTouchedFile[]
}

type SessionManagerOpen = {
  resetLeaf: () => void
  branch: (leafId: string) => void
  buildSessionContext: () => {
    thinkingLevel?: unknown
    model?: { provider?: string; modelId?: string }
  }
  getBranch: () => unknown[]
}

interface ParsedBranchCacheEntry {
  mtimeMs: number
  size: number
  builder: (path: unknown[]) => Array<Record<string, unknown>>
  touchedExtractor?: (path: unknown[]) => SessionTouchedFile[]
  all: Array<Record<string, unknown>>
  sessionMeta: SessionTimelineMeta
  touchedFiles?: SessionTouchedFile[]
}

const MAX_BRANCH_CACHE_ENTRIES = 8
const parsedBranchCache = new Map<string, ParsedBranchCacheEntry>()

let cachedSessionManagerModulePromise:
  | Promise<{ SessionManager: { open: (sessionFile: string) => SessionManagerOpen } }>
  | null = null
let cachedSessionManagerSdkPath: string | null | undefined

async function loadSessionManagerModule(activeSdkPath?: string | null): Promise<{
  SessionManager: { open: (sessionFile: string) => SessionManagerOpen }
}> {
  if (cachedSessionManagerModulePromise && cachedSessionManagerSdkPath === activeSdkPath) {
    return cachedSessionManagerModulePromise
  }
  let pkgRoot: string
  if (activeSdkPath && isAbsolute(activeSdkPath)) {
    pkgRoot = dirname(dirname(activeSdkPath))
  } else {
    const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
    const resolved = fileURLToPath(mainUrl)
    pkgRoot = dirname(dirname(resolved))
  }
  const smPath = join(pkgRoot, 'dist', 'core', 'session-manager.js')
  cachedSessionManagerSdkPath = activeSdkPath
  cachedSessionManagerModulePromise = import(pathToFileURL(smPath).href) as Promise<{
    SessionManager: { open: (sessionFile: string) => SessionManagerOpen }
  }>
  return cachedSessionManagerModulePromise
}

function cacheKeyFor(sessionFile: string, leafId: string | null | undefined): string {
  const leafTag = leafId === null ? '__NULL__' : leafId ? `leaf:${leafId}` : '__DEFAULT__'
  return `${sessionFile}\0${leafTag}`
}

function touchCacheEntry(key: string, entry: ParsedBranchCacheEntry): void {
  parsedBranchCache.delete(key)
  parsedBranchCache.set(key, entry)
  if (parsedBranchCache.size > MAX_BRANCH_CACHE_ENTRIES) {
    const oldestKey = parsedBranchCache.keys().next().value
    if (oldestKey !== undefined) parsedBranchCache.delete(oldestKey)
  }
}

export function clearParsedTimelineBranchCache(sessionFile?: string): void {
  if (!sessionFile) {
    parsedBranchCache.clear()
    return
  }
  const prefix = `${sessionFile}\0`
  for (const key of parsedBranchCache.keys()) {
    if (key.startsWith(prefix)) parsedBranchCache.delete(key)
  }
}

function paginateItems<T extends { type?: unknown }>(
  all: T[],
  offset: number,
  limit: number,
): T[] {
  const totalCount = all.length
  if (offset === 0 && limit < totalCount) {
    const start = Math.max(0, totalCount - limit)
    // A tail starting inside a turn loses its prompt during live-cache reconciliation.
    // Keep that turn intact; older pages still use the returned source row count as offset.
    let turnStart = start
    while (turnStart > 0 && all[turnStart].type !== 'user-message') turnStart--
    return all.slice(all[turnStart].type === 'user-message' ? turnStart : start)
  }
  if (offset > 0) {
    const end = totalCount - offset
    const start = Math.max(0, end - limit)
    return all.slice(start, end)
  }
  return all
}

/**
 * Read session JSONL from disk and build timeline items (preview path — no Worker loadSession).
 * Caches the parsed branch keyed by `(sessionFile, leafId)` validated against `(mtimeMs, size)`
 * so paginating older history pages slices in O(1) without re-reading/re-parsing the full file.
 */
export async function buildTimelinePageFromSessionFile(
  sessionFile: string,
  opts: {
    offset?: number
    limit?: number
    leafId?: string | null
    activeSdkPath?: string | null
  },
  timelineItemsFromBranchPath: (path: unknown[]) => Array<Record<string, unknown>>,
  extractBranchTouchedFiles?: (path: unknown[]) => SessionTouchedFile[],
): Promise<SessionTimelinePage> {
  const offset = Math.max(0, Number(opts.offset) || 0)
  const key = cacheKeyFor(sessionFile, opts.leafId)

  let fileStat: { mtimeMs: number; size: number } | null = null
  try {
    const st = await stat(sessionFile)
    if (st.isFile()) fileStat = { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    /* let SessionManager.open report unreadable/missing file errors as before */
  }

  const cached = fileStat ? parsedBranchCache.get(key) : undefined
  const needsTouched = offset === 0 && typeof extractBranchTouchedFiles === 'function'
  if (
    cached &&
    fileStat &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size &&
    cached.builder === timelineItemsFromBranchPath &&
    (!needsTouched || (cached.touchedExtractor === extractBranchTouchedFiles && cached.touchedFiles !== undefined))
  ) {
    touchCacheEntry(key, cached)
    const totalCount = cached.all.length
    const limit = Math.min(500, Math.max(1, Number(opts.limit) || totalCount || 1))
    const items = paginateItems(cached.all, offset, limit)
    return {
      items,
      totalCount,
      sessionMeta: cached.sessionMeta,
      ...(needsTouched && cached.touchedFiles ? { touchedFiles: cached.touchedFiles } : {}),
    }
  }

  const sm = await loadSessionManagerModule(opts.activeSdkPath)
  const smOpen = sm.SessionManager.open(sessionFile)
  const leafId = opts.leafId
  if (leafId === null) smOpen.resetLeaf()
  else if (typeof leafId === 'string' && leafId.length > 0) smOpen.branch(leafId)

  const ctx = smOpen.buildSessionContext()
  const sessionMeta: SessionTimelineMeta = {}
  if (ctx.thinkingLevel) sessionMeta.thinkingLevel = String(ctx.thinkingLevel)
  if (ctx.model?.provider && ctx.model?.modelId) {
    sessionMeta.model = `${ctx.model.provider}/${ctx.model.modelId}`
  }

  const branchPath = smOpen.getBranch()
  const all = timelineItemsFromBranchPath(branchPath)
  const touchedFiles = needsTouched ? extractBranchTouchedFiles(branchPath) : undefined

  if (fileStat) {
    touchCacheEntry(key, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      builder: timelineItemsFromBranchPath,
      touchedExtractor: needsTouched ? extractBranchTouchedFiles : undefined,
      all,
      sessionMeta,
      touchedFiles,
    })
  }

  const totalCount = all.length
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || totalCount || 1))
  const items = paginateItems(all, offset, limit)
  return {
    items,
    totalCount,
    sessionMeta,
    ...(touchedFiles ? { touchedFiles } : {}),
  }
}

export function sessionTimelineError(e: unknown): string {
  return `getMessages failed: ${errorMessage(e)}`
}
