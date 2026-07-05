import { app } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveActiveSdk } from '../sdk-loader'

export function getActiveSdkModule(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const active = resolveActiveSdk(app.getPath('userData'))
  if (active.kind === 'builtin') {
    return import(active.entryPath)
  }
  return import(pathToFileURL(active.entryPath).href)
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