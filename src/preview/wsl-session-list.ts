import { pathToFileURL } from 'node:url'

export type SessionOnDiskRow = {
  id: string
  path: string
  cwd?: string
  name?: string
  firstMessage?: string
  created?: Date
  modified?: Date
  messageCount?: number
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? undefined : new Date(ms)
  }
  return undefined
}

export function toSessionOnDiskRows(rows: unknown[]): SessionOnDiskRow[] {
  return rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((row) => ({
      id: String(row.id ?? ''),
      path: String(row.path ?? row.sessionFile ?? ''),
      cwd: typeof row.cwd === 'string' ? row.cwd : undefined,
      name: typeof row.name === 'string' ? row.name : undefined,
      firstMessage: typeof row.firstMessage === 'string' ? row.firstMessage : undefined,
      created: toDate(row.created),
      modified: toDate(row.modified),
      messageCount: typeof row.messageCount === 'number' ? row.messageCount : undefined,
    }))
}

const LIST_SESSIONS_TTL_MS = 3_000
const listSessionsCache = new Map<string, { at: number; value: SessionOnDiskRow[] }>()
const listSessionsRevisions = new Map<string, number>()
let listSessionsGeneration = 0

export function invalidateListSessionsCache(workspaceId?: string): void {
  if (workspaceId) {
    listSessionsCache.delete(workspaceId)
    listSessionsRevisions.set(workspaceId, (listSessionsRevisions.get(workspaceId) ?? 0) + 1)
    return
  }
  listSessionsCache.clear()
  listSessionsGeneration++
  listSessionsRevisions.clear()
}

export async function listSessionsOnDisk(
  workspaceId: string,
  activeSdkPath: string,
): Promise<SessionOnDiskRow[]> {
  const cached = listSessionsCache.get(workspaceId)
  if (cached && Date.now() - cached.at < LIST_SESSIONS_TTL_MS) return cached.value
  const generation = listSessionsGeneration
  const revision = listSessionsRevisions.get(workspaceId) ?? 0
  const sdk = await import(pathToFileURL(activeSdkPath).href) as {
    SessionManager: { list: (cwd: string) => Promise<unknown[]> }
  }
  const value = toSessionOnDiskRows(await sdk.SessionManager.list(workspaceId))
  if (
    listSessionsGeneration === generation &&
    (listSessionsRevisions.get(workspaceId) ?? 0) === revision
  ) {
    listSessionsCache.set(workspaceId, { at: Date.now(), value })
  }
  return value
}
