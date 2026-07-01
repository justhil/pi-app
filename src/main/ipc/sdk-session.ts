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

export async function listSessionsOnDisk(workspaceId: string): Promise<any[]> {
  const { SessionManager } = await getActiveSdkModule()
  return await SessionManager.list(workspaceId)
}