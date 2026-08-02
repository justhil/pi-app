import { app } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveActiveSdk, type SdkKind } from '../sdk-loader'

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

export async function listSessionsOnDisk(workspaceId: string): Promise<SessionOnDiskRow[]> {
  const { SessionManager } = await getActiveSdkModule()
  return (await SessionManager.list(workspaceId)) as SessionOnDiskRow[]
}