import { stat } from 'fs/promises'
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
import { sessionPreviewProcess } from '../../session-preview-process'
import { listSessionsOnDisk } from '../sdk-session'
import { archiveSessionsByRule, getArchivedAt, isSessionArchived } from '../../session-archive'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { workspaceOpenSchema, workspaceSandboxDeleteSchema } from '../schemas'
import { errorMessage } from '@shared/error-message'
import { getMainWindow } from '../../window'
import { refreshGitWorkspaceWatch } from '../../git-workspace-watch'

export function registerWorkspaceHandlers(): void {
  registerHandler('ipc:workspace.ensureWorker', async (req) => {
    const path = String(req?.path || '').trim()
    if (!path) return { ok: false, workspaceId: '', error: 'missing path' }
    configStore.set('currentProject', path)
    try {
      const r = await workerManager.start(path)
      refreshGitWorkspaceWatch(getMainWindow())
      return { ok: true, workspaceId: path, sessionId: r.sessionId, model: r.model }
    } catch (e: unknown) {
      return { ok: false, workspaceId: path, error: errorMessage(e) || 'Worker start failed' }
    }
  })

  registerHandlerWithSchema('ipc:workspace.open', workspaceOpenSchema, async (req) => {
    const path = req.path
    const name = path.split(/[\\/]/).pop() || path
    invalidateAdapterCatalog()
    configStore.addRecentProject(path)
    configStore.set('currentProject', path)
    try {
      sqliteIndex.upsertWorkspace(path, name, path)
    } catch (e) {
      console.warn('[IPC] workspace index skipped (sqlite):', (e as Error).message)
    }
    // awaitWorker true: block until Worker is ready (legacy / explicit).
    // awaitWorker false / omitted: register project only; Worker starts on first
    // Worker-required action (prompt / session.new / ensureWorker).
    if (req.awaitWorker === true) {
      try {
        await workerManager.start(path)
        refreshGitWorkspaceWatch(getMainWindow())
      } catch (e) {
        console.error('[IPC] Worker start failed:', e)
        throw e
      }
    } else {
      refreshGitWorkspaceWatch(getMainWindow())
    }
    return { workspaceId: path, path, name }
  })

  registerHandler('ipc:workspace.switch', async (req) => {
    const result = await workerManager.start(req.workspaceId)
    refreshGitWorkspaceWatch(getMainWindow())
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
            const latest = (await sessionPreviewProcess.listSessions(s.path).catch(() => []))[0]
            if (latest?.id && latest.path) {
              s.sessionId = latest.id
              s.sessionFile = latest.path
              bindSandboxSession(s.path, latest.id, latest.path)
            }
          }
          return s.sessionId && s.sessionFile ? { ...s, kind: 'sandbox' as const } : null
        }),
      )
    )
      .filter((s): s is NonNullable<typeof s> => s != null)
      // 归档的普通对话从默认列表隐藏（恢复入口在“已归档”分组）
      .filter((s) => !isSessionArchived(s.sessionFile || s.path))
    return { sandboxes }
  })

  registerHandler('ipc:workspace.sandbox.listArchived', async () => {
    const items = listSandboxWorkspaces()
      .map((s) => {
        const at = getArchivedAt(s.sessionFile || s.path)
        return at != null ? { ...s, kind: 'sandbox' as const, archivedAt: at } : null
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.archivedAt - a.archivedAt)
    return { sandboxes: items }
  })

  registerHandler('ipc:workspace.sandbox.archiveBatch', async (req) => {
    const before = Number(req.before) || 0
    const keepRecent = req.keepRecent == null ? undefined : Math.max(0, Number(req.keepRecent) || 0)
    if (req.before == null && req.keepRecent == null) return { ok: false, error: 'missing rule (before | keepRecent)' }
    try {
      // 普通对话：每个 box 对应一个会话；按绑定会话文件的 mtime（最后活动）判定，缺失时回退到创建时间
      const rows = await Promise.all(
        listSandboxWorkspaces().map(async (b) => {
          const file = b.sessionFile || b.path
          let modified: Date | null = null
          if (file) {
            try {
              modified = (await stat(file)).mtime
            } catch {
              modified = null
            }
          }
          return { path: file, modified: modified ?? new Date(b.createdAt) }
        }),
      )
      const archived = archiveSessionsByRule({
        rows,
        before: before > 0 ? before : undefined,
        keepRecent,
      })
      return { ok: true, archived }
    } catch (e: unknown) {
      return { ok: false, error: errorMessage(e) || 'archiveBatch failed' }
    }
  })

  registerHandler('ipc:workspace.sandbox.rename', async (req) => {
    return { ok: renameSandboxWorkspace(req.path, req.label || '') }
  })

  registerHandlerWithSchema('ipc:workspace.sandbox.delete', workspaceSandboxDeleteSchema, async (req) => {
    return { ok: deleteSandboxWorkspace(req.path) }
  })

  registerHandler('ipc:workspace.isSandbox', async (req) => {
    return { sandbox: isSandboxWorkspacePath(req.path || '') }
  })
}