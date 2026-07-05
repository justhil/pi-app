import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join, isAbsolute } from 'node:path'
import { errorMessage } from './error-message'

export type SessionTimelineMeta = { model?: string; thinkingLevel?: string }

export type SessionTimelinePage = {
  items: Array<Record<string, unknown>>
  totalCount: number
  sessionMeta?: SessionTimelineMeta
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

async function loadSessionManagerModule(activeSdkPath?: string | null): Promise<{
  SessionManager: { open: (sessionFile: string) => SessionManagerOpen }
}> {
  let pkgRoot: string
  if (activeSdkPath && isAbsolute(activeSdkPath)) {
    pkgRoot = dirname(dirname(activeSdkPath))
  } else {
    const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
    const resolved = fileURLToPath(mainUrl)
    pkgRoot = dirname(dirname(resolved))
  }
  const smPath = join(pkgRoot, 'dist', 'core', 'session-manager.js')
  return (await import(pathToFileURL(smPath).href)) as {
    SessionManager: { open: (sessionFile: string) => SessionManagerOpen }
  }
}

function paginateItems<T>(
  all: T[],
  offset: number,
  limit: number,
): T[] {
  const totalCount = all.length
  if (offset === 0 && limit < totalCount) {
    return all.slice(Math.max(0, totalCount - limit))
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
 * When leafId is set (Worker bound to same file), branch matches live session leaf.
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
): Promise<SessionTimelinePage> {
  const offset = Math.max(0, Number(opts.offset) || 0)
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
  const totalCount = all.length
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || totalCount || 1))
  const items = paginateItems(all, offset, limit)
  return { items, totalCount, sessionMeta }
}

export function sessionTimelineError(e: unknown): string {
  return `getMessages failed: ${errorMessage(e)}`
}