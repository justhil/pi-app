import { pathToFileURL } from 'node:url'
import { resolveActiveSdk, type SdkKind } from '../sdk-loader'

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

export function getActiveSdkModule(
  userDataDir: string,
  activeSdkPath?: string | null,
): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  if (activeSdkPath) return import(pathToFileURL(activeSdkPath).href)
  const active = resolveActiveSdk(userDataDir)
  if (active.kind === 'builtin') {
    return import(active.entryPath)
  }
  return import(pathToFileURL(active.entryPath).href)
}

/**
 * Warm the SDK module graph in the background so the first folder click / session
 * open never pays a cold dynamic import (measured ~0.8–2s for the global SDK in
 * Electron). Runs once per app start; safe to call multiple times (Node caches).
 */
export function warmSdkModules(): void {
  void (async () => {
    try {
      await getActiveSdkModule()
      // Also preload the session-manager module used by getMessages / tree reads
      // (a separate module graph from the package index).
      const { buildTimelinePageFromSessionFile } = await import('@shared/session-jsonl-timeline')
      void buildTimelinePageFromSessionFile
    } catch (e) {
      console.warn('[sdk] warm-up failed:', e)
    }
  })()
}

type ProbedSdkModule = Record<string, unknown>

export function validateSelectedSdkModule(sdk: ProbedSdkModule): void {
  if (typeof sdk.getAgentDir !== 'function') throw new Error('SDK 缺少 getAgentDir export')
  const sessionManager = sdk.SessionManager as Record<string, unknown> | undefined
  if (!sessionManager || typeof sessionManager.create !== 'function') {
    throw new Error('SDK 缺少 SessionManager.create export')
  }
  const hasRuntimeSessionFactory =
    typeof sdk.ModelRuntime === 'function' &&
    typeof sdk.createAgentSessionRuntime === 'function' &&
    typeof sdk.createAgentSessionServices === 'function' &&
    typeof sdk.createAgentSessionFromServices === 'function'
  if (!hasRuntimeSessionFactory) {
    throw new Error('SDK 缺少 ModelRuntime session services，请切换到 Pi 0.83.0 或更高版本')
  }
}

export async function probeSelectedSdk(target: SdkKind, userDataDir: string): Promise<{
  kind: SdkKind
  version: string
  fallbackReason?: string
}> {
  const active = resolveActiveSdk(userDataDir)
  if (active.kind !== target) throw new Error(`预期 ${target}，实际 ${active.kind}`)
  const sdk = await getActiveSdkModule(userDataDir)
  validateSelectedSdkModule(sdk as unknown as ProbedSdkModule)
  return { kind: active.kind, version: active.version, fallbackReason: active.fallbackReason }
}

// WSL 下 session.list 走 worker 通道（可能 fork 专职 worker，秒级），
// 会话切换时渲染进程会连续触发多次 list，用短 TTL 缓存合并它们。
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
  userDataDir: string,
  rowsFromWorker?: unknown[],
  activeSdkPath?: string | null,
): Promise<SessionOnDiskRow[]> {
  const cached = listSessionsCache.get(workspaceId)
  if (cached && Date.now() - cached.at < LIST_SESSIONS_TTL_MS) return cached.value
  const generation = listSessionsGeneration
  const revision = listSessionsRevisions.get(workspaceId) ?? 0
  const value = rowsFromWorker
    ? toSessionOnDiskRows(rowsFromWorker)
    : toSessionOnDiskRows(
        await (await getActiveSdkModule(userDataDir, activeSdkPath)).SessionManager.list(workspaceId),
      )
  if (
    listSessionsGeneration === generation &&
    (listSessionsRevisions.get(workspaceId) ?? 0) === revision
  ) {
    listSessionsCache.set(workspaceId, { at: Date.now(), value })
  }
  return value
}
