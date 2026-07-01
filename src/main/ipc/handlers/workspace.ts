import { invalidateAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { configStore } from '../../config-store'
import { sqliteIndex } from '../../sqlite-index'
import { workerManager } from '../../worker-manager'
import {
  bindSandboxSession,
  createSandboxWorkspace,
  deleteSandboxWorkspace,
  isSandboxWorkspacePath,
  listSandboxWorkspaces,
  renameSandboxWorkspace,
} from '../../sandbox-workspaces'
import { listSessionsOnDisk } from '../sdk-session'
import { registerHandler } from '../registry'

export function registerWorkspaceHandlers(): void {
  registerHandler('ipc:workspace.ensureWorker', async (req) => {
    const path = String(req?.path || '').trim()
    if (!path) return { ok: false, workspaceId: '', error: 'missing path' }
    configStore.set('currentProject', path)
    try {
      const r = await workerManager.start(path)
      return { ok: true, workspaceId: path, sessionId: r.sessionId, model: r.model }
    } catch (e: any) {
      return { ok: false, workspaceId: path, error: e?.message || 'Worker start failed' }
    }
  })

  registerHandler('ipc:workspace.open', async (req) => {
    const path = req.path
    if (!path) return { workspaceId: '', path: '', name: '' }
    const name = path.split(/[\\/]/).pop() || path
    invalidateAdapterCatalog()
    configStore.addRecentProject(path)
    configStore.set('currentProject', path)
    try {
      sqliteIndex.upsertWorkspace(path, name, path)
    } catch (e) {
      console.warn('[IPC] workspace index skipped (sqlite):', (e as Error).message)
    }
    if (req.awaitWorker) {
      try {
        await workerManager.start(path)
      } catch (e) {
        console.error('[IPC] Worker start failed:', e)
        throw e
      }
    } else {
      workerManager
        .start(path)
        .then((result) => console.log('[IPC] Worker started for', path, result.sessionId))
        .catch((e) => console.error('[IPC] Worker start failed:', e))
    }
    return { workspaceId: path, path, name }
  })

  registerHandler('ipc:workspace.switch', async (req) => {
    const result = await workerManager.start(req.workspaceId)
    return {
      workspaceId: req.workspaceId,
      path: req.workspaceId,
      name: req.workspaceId.split(/[\\/]/).pop(),
      ...result,
    }
  })

  registerHandler('ipc:workspace.sandbox.create', async (req) => {
    const box = createSandboxWorkspace(req.label)
    return { sandbox: { ...box, kind: 'sandbox' as const } }
  })

  registerHandler('ipc:workspace.sandbox.list', async () => {
    const sandboxes = (
      await Promise.all(
        listSandboxWorkspaces().map(async (s) => {
          if (!s.sessionId || !s.sessionFile) {
            const latest = (await listSessionsOnDisk(s.path).catch(() => []))[0]
            if (latest?.id && latest.path) {
              s.sessionId = latest.id
              s.sessionFile = latest.path
              bindSandboxSession(s.path, latest.id, latest.path)
            }
          }
          return s.sessionId && s.sessionFile ? { ...s, kind: 'sandbox' as const } : null
        }),
      )
    ).filter(Boolean)
    return { sandboxes }
  })

  registerHandler('ipc:workspace.sandbox.rename', async (req) => {
    return { ok: renameSandboxWorkspace(req.path, req.label || '') }
  })

  registerHandler('ipc:workspace.sandbox.delete', async (req) => {
    return { ok: deleteSandboxWorkspace(req.path) }
  })

  registerHandler('ipc:workspace.isSandbox', async (req) => {
    return { sandbox: isSandboxWorkspacePath(req.path || '') }
  })
}