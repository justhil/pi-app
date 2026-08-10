// WSL-native, read-only session preview runner.
// This entry intentionally imports only SDK/session parsing code: no live agent runtime.

import {
  invalidateListSessionsCache,
  listSessionsOnDisk,
} from './wsl-session-list'
import { getSessionMessagesFromDisk } from '../main/session-messages-from-disk'
import { flattenTreeFromSessionFile } from '../main/session-tree-from-file'
import { applyPiSettingsPatch } from '../worker/pi-settings-patch'
import { buildSystemPromptPreview } from '../main/system-prompt-preview'
import { encodeWorkerFrame, WORKER_STDIO_ENV, WORKER_WSL_DISTRO_ENV } from '@shared/worker-frame'
import { wslPathToWindows } from '@shared/wsl-path'
import type { WorkerIncomingMessage } from '../worker/worker-port-types'

if (process.env[WORKER_STDIO_ENV] !== '1') throw new Error('WSL preview requires stdio mode')
const distro = process.env[WORKER_WSL_DISTRO_ENV]
if (!distro) throw new Error('WSL preview requires a distro')

type WslPreviewRequest = WorkerIncomingMessage & {
  type:
    | 'session.list'
    | 'session.getMessages'
    | 'session.tree'
    | 'session.invalidateList'
    | 'pi.settings.set'
    | 'system.prompt'
  userDataDir: string
  sdkPath: string
  workspaceId?: string
}

function reply(requestId: string | undefined, payload: Record<string, unknown>): void {
  process.stdout.write(encodeWorkerFrame({ requestId, ...payload }) + '\n')
}

async function handleRequest(message: WslPreviewRequest): Promise<void> {
  try {
    let result: unknown
    if (message.type === 'session.list') {
      result = (await listSessionsOnDisk(
        String(message.cwd || ''),
        message.sdkPath,
      )).map((row) => ({
        ...row,
        path: wslPathToWindows(distro, row.path),
        cwd: row.cwd ? wslPathToWindows(distro, row.cwd) : row.cwd,
      }))
    } else if (message.type === 'session.invalidateList') {
      invalidateListSessionsCache(
        typeof message.workspaceId === 'string' && message.workspaceId
          ? message.workspaceId
          : undefined,
      )
      result = null
    } else if (message.type === 'session.getMessages') {
      result = await getSessionMessagesFromDisk(
        String(message.sessionFile || ''),
        Number(message.offset || 0),
        message.limit == null ? undefined : Number(message.limit),
        message.leafId as string | null | undefined,
        message.sdkPath,
        message.showNonMessageEntries === true ? { showNonMessageEntries: true } : undefined,
      )
    } else if (message.type === 'session.tree') {
      result = await flattenTreeFromSessionFile(
        String(message.sessionFile || ''),
        String(message.cwd || ''),
        message.leafId as string | null | undefined,
        message.sdkPath,
        message.showNonMessageEntries === true ? { showNonMessageEntries: true } : undefined,
      )
    } else if (message.type === 'pi.settings.set') {
      const sdk = await import(message.sdkPath)
      const manager = sdk.SettingsManager.create(
        String(message.cwd || '/'),
        sdk.getAgentDir(),
        { projectTrusted: false },
      )
      await applyPiSettingsPatch(manager, (message.patch as Record<string, unknown>) || {})
      result = null
    } else if (message.type === 'system.prompt') {
      const sdk = await import(message.sdkPath)
      result = await buildSystemPromptPreview(
        sdk,
        String(message.cwd || '/'),
        (message.globalSettings as Record<string, unknown>) || {},
        (message.projectSettings as Record<string, unknown>) || {},
      )
    } else {
      throw new Error(`Unknown WSL preview request: ${String((message as { type?: string }).type)}`)
    }
    reply(message.requestId, { type: `${message.type}-done`, result })
  } catch (error) {
    reply(message.requestId, {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (line.trim()) {
      try {
        void handleRequest(JSON.parse(line) as WslPreviewRequest)
      } catch (error) {
        console.error('[WSL Preview] malformed request:', error)
      }
    }
    newline = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
