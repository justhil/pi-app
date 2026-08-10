import { app } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveActiveSdk, type SdkKind } from '../sdk-loader'
import { isWslWindowsPath } from '@shared/wsl-path'

export function getActiveSdkModule(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const active = resolveActiveSdk(app.getPath('userData'))
  if (active.kind === 'builtin') {
    return import(active.entryPath)
  }
  return import(pathToFileURL(active.entryPath).href)
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

export async function probeSelectedSdk(target: SdkKind): Promise<{
  kind: SdkKind
  version: string
  fallbackReason?: string
}> {
  const active = resolveActiveSdk(app.getPath('userData'))
  if (active.kind !== target) throw new Error(`预期 ${target}，实际 ${active.kind}`)
  const sdk = await getActiveSdkModule()
  validateSelectedSdkModule(sdk as unknown as ProbedSdkModule)
  return { kind: active.kind, version: active.version, fallbackReason: active.fallbackReason }
}

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

// WSL 下 session.list 走 worker 通道（可能 fork 专职 worker，秒级），
// 会话切换时渲染进程会连续触发多次 list，用短 TTL 缓存合并它们。
const LIST_SESSIONS_TTL_MS = 3_000
const listSessionsCache = new Map<string, { at: number; value: SessionOnDiskRow[] }>()

export function invalidateListSessionsCache(workspaceId?: string): void {
  if (workspaceId) {
    listSessionsCache.delete(workspaceId)
    return
  }
  listSessionsCache.clear()
}

export async function listSessionsOnDisk(workspaceId: string): Promise<SessionOnDiskRow[]> {
  const cached = listSessionsCache.get(workspaceId)
  if (cached && Date.now() - cached.at < LIST_SESSIONS_TTL_MS) return cached.value
  const value = await listSessionsUncached(workspaceId)
  listSessionsCache.set(workspaceId, { at: Date.now(), value })
  return value
}

async function listSessionsUncached(workspaceId: string): Promise<SessionOnDiskRow[]> {
  // WSL 模式下会话写在 WSL 发行版内（`~/.pi/agent/sessions`），主进程（Windows
  // 宿主）直读 SDK 会按宿主 home 找错目录且编码不出 WSL 原生 cwd，列表恒为空。
  // 改走 worker 通道：worker 在 WSL 内用原生路径调用 SessionManager.list，
  // worker-path-bridge 再把 sessionFile/cwd 翻译回 Windows 视角。
  const [{ workerManager }, { isWslRuntimeActive }] = await Promise.all([
    import('../worker-manager'),
    import('../wsl/runtime-config'),
  ])
  // WSL 模式下所有 worker 都在 WSL 内（forkWorkerForCwd 按 runtime 而非路径决定），
  // 会话统一写在 WSL 发行版里；即使 workspaceId 是宿主路径（如 sandbox 的
  // `C:\Users\...\sandbox-workspaces\...`）也不能 host 直读，必须走 worker 通道。
  // host 模式才允许宿主直接读 SDK 会话目录。
  const isWslPath = isWslWindowsPath(workspaceId) || isWslRuntimeActive()
  if (isWslPath) {
    try {
      const rows = await workerManager.listSessions(workspaceId)
      return rows
        .filter((r): r is Record<string, unknown> => r != null && typeof r === 'object')
        .map((row) => {
          return {
            id: String(row.id ?? ''),
            path: String(row.path ?? row.sessionFile ?? ''),
            cwd: typeof row.cwd === 'string' ? row.cwd : undefined,
            name: typeof row.name === 'string' ? row.name : undefined,
            firstMessage: typeof row.firstMessage === 'string' ? row.firstMessage : undefined,
            created: toDate(row.created),
            modified: toDate(row.modified),
            messageCount: typeof row.messageCount === 'number' ? row.messageCount : undefined,
          } satisfies SessionOnDiskRow
        })
    } catch (e) {
      console.error('[listSessionsOnDisk] WSL worker channel failed:', e)
      return []
    }
  }
  const { SessionManager } = await getActiveSdkModule()
  return (await SessionManager.list(workspaceId)) as SessionOnDiskRow[]
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