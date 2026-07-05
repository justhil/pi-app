import { configStore } from '../../config-store'
import { workerManager } from '../../worker-manager'
import { listRewindCheckpoints } from '../../pi-rewind-read'
import { listMessageAnchorsFromSessionFile } from '../../session-branch-anchors'
import { readSessionIdFromFile } from '../../session-file-meta'
import {
  clearSessionDisplayName,
  resolveSessionListTitle,
  setSessionDisplayName,
} from '../../session-display-names'
import {
  bindSandboxSession,
  isSandboxWorkspacePath,
  renameSandboxWorkspace,
} from '../../sandbox-workspaces'
import {
  ensureWorkerSessionBound,
  getPendingWorkerSessionFile,
  setPendingEphemeralSandboxDraft,
  setPendingWorkerSessionFile,
} from '../../session-bind-state'
import { flattenTreeFromSessionFile } from '../../session-tree-from-file'
import { listSessionsOnDisk, type SessionOnDiskRow } from '../sdk-session'
import type { PiSessionMessage } from '@shared/worker-message'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  sessionDeleteSchema,
  sessionExportSchema,
  sessionGetMessagesSchema,
  sessionNavigateTreeSchema,
  sessionNewSchema,
  sessionPrepareSchema,
} from '../schemas'
import { errorMessage } from '@shared/error-message'

export function registerSessionHandlers(): void {
  registerHandler('ipc:session.list', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    const sessions = workspaceId ? await listSessionsOnDisk(workspaceId) : []
    const formatted = sessions.map((s: SessionOnDiskRow) => ({
      sessionId: s.id,
      sessionFile: s.path,
      workspaceId: s.cwd || workspaceId,
      title: resolveSessionListTitle(
        s.path,
        s.name || s.firstMessage?.slice(0, 60) || s.id.slice(0, 8),
      ),
      createdAt: s.created?.getTime() || 0,
      updatedAt: s.modified?.getTime() || 0,
      messageCount: s.messageCount || 0,
      modelId: '',
      status: 'idle' as const,
    }))
    return { sessions: formatted }
  })

  registerHandler('ipc:session.open', async (req) => {
    const sessionId = req.sessionId
    if (req.sessionFile) setPendingWorkerSessionFile(req.sessionFile)
    return {
      session: {
        sessionId,
        workspaceId: workerManager.cwd || '',
        title: '',
        createdAt: 0,
        updatedAt: 0,
        modelId: '',
        status: 'idle' as const,
      },
    }
  })

  registerHandler('ipc:session.setPendingBind', async (req) => {
    setPendingWorkerSessionFile(req.sessionFile ?? null)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:session.prepare', sessionPrepareSchema, async (req) => {
    const sessionFile = req.sessionFile
    if (!sessionFile) {
      setPendingWorkerSessionFile(null)
      return { bound: false, sessionId: null as string | null }
    }
    try {
      const r = await workerManager.loadSession(sessionFile, { force: true })
      setPendingWorkerSessionFile(null)
      return {
        bound: true,
        sessionId: r.sessionId,
        model: r.model,
        thinkingLevel: (r as { thinkingLevel?: string }).thinkingLevel,
      }
    } catch (e: unknown) {
      setPendingWorkerSessionFile(sessionFile)
      return { bound: false, sessionId: readSessionIdFromFile(sessionFile), error: errorMessage(e) }
    }
  })

  registerHandler('ipc:session.setEphemeralDraft', async (req) => {
    setPendingEphemeralSandboxDraft(!!req.active)
    if (req.active) setPendingWorkerSessionFile(null)
    return { ok: true }
  })

  registerHandler('ipc:session.tree', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    let sessionFile = req?.sessionFile as string | undefined
    let workerSessionFile: string | undefined
    let leafOverride: string | null | undefined
    if (workerManager.isRunning) {
      const st = await workerManager.getState().catch(() => null)
      workerSessionFile = (st as { sessionFile?: string } | null)?.sessionFile
      if (!sessionFile) sessionFile = workerSessionFile
      if (sessionFile && workerSessionFile === sessionFile && 'leafId' in (st || {})) {
        leafOverride = ((st as { leafId?: string | null }).leafId) ?? null
      }
    }
    if (sessionFile) {
      try {
        const r = await flattenTreeFromSessionFile(sessionFile, cwd, leafOverride ?? undefined)
        return { nodes: r.nodes, leafId: r.leafId, workerBound: workerSessionFile === sessionFile }
      } catch (e: unknown) {
        return { nodes: [], leafId: null, error: errorMessage(e) }
      }
    }
    try {
      const p = workerManager.getSessionTree()
      const timeout = new Promise<{ nodes: []; leafId: null; error: string }>((resolve) =>
        setTimeout(() => resolve({ nodes: [], leafId: null, error: 'timeout' }), 15000),
      )
      return await Promise.race([p, timeout])
    } catch (e: unknown) {
      return { nodes: [], leafId: null, error: errorMessage(e) }
    }
  })

  registerHandlerWithSchema('ipc:session.navigateTree', sessionNavigateTreeSchema, async (req) => {
    try {
      await ensureWorkerSessionBound((f, o) => workerManager.loadSession(f, o), { sessionFile: req.sessionFile })
      return await workerManager.navigateTree(req.targetId, {
        summarize: req.summarize === true,
        label: req.label,
      })
    } catch (e: unknown) {
      return { cancelled: true, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:session.branchAnchors', async (req) => {
    const file =
      req.sessionFile ||
      ((await workerManager.getState().catch(() => null)) as { sessionFile?: string } | null)?.sessionFile
    if (!file) return { anchors: [] }
    return { anchors: listMessageAnchorsFromSessionFile(file) }
  })

  registerHandler('ipc:rewind.checkpoints', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || ''
    if (!cwd) return { checkpoints: [] }
    let sessionId = req.sessionId as string | undefined
    if (!sessionId) {
      const state = await workerManager.getState().catch(() => null)
      sessionId = (state as { sessionId?: string } | null)?.sessionId
    }
    if (!sessionId && req.sessionFile) sessionId = readSessionIdFromFile(req.sessionFile) || undefined
    return { checkpoints: listRewindCheckpoints(cwd, sessionId || undefined) }
  })

  registerHandler('ipc:rewind.runCommand', async (req) => {
    await workerManager.runExtensionCommand(String(req.text || '/rewind').trim())
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:session.getMessages', sessionGetMessagesSchema, async (req) => {
    if (!req.sessionFile) return { items: [], totalCount: 0 }
    const offset = req.offset ?? 0
    const limit = req.limit ?? 0
    try {
      if (workerManager.isRunning) {
        let leafId: string | null | undefined
        try {
          const st = await workerManager.getState()
          if (st?.sessionFile === req.sessionFile && 'leafId' in st) {
            leafId = (st.leafId as string | null | undefined) ?? null
          }
        } catch {
          /* use default leaf from file */
        }
        const r = await workerManager.getMessages(req.sessionFile, offset, limit || undefined)
        if (r.items.length > 0 || (r.totalCount ?? 0) > 0) {
          return { items: r.items, totalCount: r.totalCount, sessionMeta: r.sessionMeta }
        }
        const { getSessionMessagesFromDisk } = await import('../../session-messages-from-disk.js')
        const disk = await getSessionMessagesFromDisk(req.sessionFile, offset, limit || undefined, leafId)
        return { items: disk.items, totalCount: disk.totalCount, sessionMeta: disk.sessionMeta }
      }
      const { getSessionMessagesFromDisk } = await import('../../session-messages-from-disk.js')
      const disk = await getSessionMessagesFromDisk(req.sessionFile, offset, limit || undefined)
      return { items: disk.items, totalCount: disk.totalCount, sessionMeta: disk.sessionMeta }
    } catch (e: unknown) {
      console.error('[IPC] session.getMessages failed:', e)
      return { items: [], totalCount: 0, error: errorMessage(e) || 'get_messages_failed' }
    }
  })

  registerHandlerWithSchema('ipc:session.new', sessionNewSchema, async (req) => {
    const workspaceId = req.workspaceId
    if (!workerManager.isRunning || workerManager.cwd !== workspaceId) {
      await workerManager.start(workspaceId)
    }
    setPendingWorkerSessionFile(null)
    const result = await workerManager.newSession()
    const state = await workerManager.getState().catch(() => ({}))
    const sessionFile = (state as { sessionFile?: string })?.sessionFile
    if (isSandboxWorkspacePath(workspaceId)) {
      bindSandboxSession(workspaceId, result.sessionId, sessionFile)
    }
    return {
      session: {
        sessionId: result.sessionId,
        sessionFile,
        workspaceId,
        title: '新会话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        modelId: '',
        status: 'idle' as const,
      },
    }
  })

  registerHandler('ipc:session.fork', async (req) => {
    const title = String(req?.title || '')
    try {
      if (!workerManager.isRunning) {
        return {
          session: {
            sessionId: '',
            workspaceId: '',
            title: 'Fork',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'worker_not_ready',
          },
        }
      }
      const newSess = await workerManager.newSession()
      return {
        session: {
          sessionId: newSess.sessionId,
          workspaceId: workerManager.cwd || '',
          title: title || 'Fork',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modelId: '',
          status: 'idle' as const,
        },
      }
    } catch (e: unknown) {
      return {
        session: {
          sessionId: '',
          workspaceId: '',
          title: 'Fork',
          createdAt: 0,
          updatedAt: 0,
          modelId: '',
          status: 'idle' as const,
          error: errorMessage(e),
        },
      }
    }
  })

  registerHandler('ipc:session.clone', async (req) => {
    const title = String(req?.title || '')
    try {
      if (!workerManager.isRunning) {
        return {
          session: {
            sessionId: '',
            workspaceId: '',
            title: 'Clone',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'worker_not_ready',
          },
        }
      }
      const newSess = await workerManager.newSession()
      return {
        session: {
          sessionId: newSess.sessionId,
          workspaceId: workerManager.cwd || '',
          title: title || 'Clone',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modelId: '',
          status: 'idle' as const,
        },
      }
    } catch (e: unknown) {
      return {
        session: {
          sessionId: '',
          workspaceId: '',
          title: 'Clone',
          createdAt: 0,
          updatedAt: 0,
          modelId: '',
          status: 'idle' as const,
          error: errorMessage(e),
        },
      }
    }
  })

  registerHandler('ipc:session.rename', async (req) => {
    const title = (req.title || '').trim()
    if (!title) return { ok: false, title: req.title }
    const cwd = workerManager.cwd || configStore.get('currentProject') || ''
    if (req.sandboxPath && isSandboxWorkspacePath(req.sandboxPath)) {
      renameSandboxWorkspace(req.sandboxPath, title)
      return { ok: true, title }
    }
    if (isSandboxWorkspacePath(cwd) && !req.sessionFile) {
      renameSandboxWorkspace(cwd, title)
      return { ok: true, title }
    }
    const file = req.sessionFile as string | undefined
    if (!file) return { ok: false, title, error: 'missing sessionFile' }
    setSessionDisplayName(file, title)
    return { ok: true, title }
  })

  registerHandlerWithSchema('ipc:session.delete', sessionDeleteSchema, async (req) => {
    const file = req.sessionFile
    const r = await workerManager.deleteSessionFile(file)
    if (r.ok) clearSessionDisplayName(file)
    return { ok: !!r.ok, error: r.error }
  })

  registerHandler('ipc:session.reloadFromDisk', async (req) => {
    const sessionFile =
      (req.sessionFile as string | undefined) || getPendingWorkerSessionFile() || undefined
    if (!sessionFile) return { ok: false, error: 'no session file' }
    try {
      const st = await workerManager.getState().catch(() => null)
      if (workerManager.isRunning && (st as { sessionFile?: string } | null)?.sessionFile === sessionFile) {
        await workerManager.loadSession(sessionFile)
      }
      return { ok: true, sessionFile }
    } catch (e: unknown) {
      return { ok: false, error: errorMessage(e) || 'reload failed' }
    }
  })

  registerHandler('ipc:project.removeRecent', async (req) => {
    const path = (req.path as string | undefined)?.trim()
    if (!path) return { ok: false, error: 'missing path' }
    configStore.removeRecentProject(path)
    const cur = configStore.get('currentProject')
    if (cur === path) {
      const recent = configStore.get('recentProjects') || []
      const next = recent.find((p) => p && p !== path) || null
      configStore.set('currentProject', next)
    }
    return { ok: true, currentProject: configStore.get('currentProject') }
  })

  registerHandler('ipc:session.compact', async () => {
    try {
      if (!workerManager.isRunning) {
        return { sessionId: '', compacted: false, tokensSaved: 0, error: 'worker_not_ready' }
      }
      await workerManager.runExtensionCommand('/compact')
      return { sessionId: '', compacted: true, tokensSaved: 0 }
    } catch (e: unknown) {
      return { sessionId: '', compacted: false, tokensSaved: 0, error: errorMessage(e) }
    }
  })

  registerHandlerWithSchema('ipc:session.export', sessionExportSchema, async (req) => {
    const format = String(req.format || 'json')
    const sessionFile = String(req.sessionFile || '')
    try {
      if (!sessionFile) return { content: '', format, filename: 'export', error: 'missing sessionFile' }
      if (!workerManager.isRunning) {
        return { content: '', format, filename: 'export', error: 'worker_not_ready' }
      }
      const messages = await workerManager.getMessages(sessionFile, 0, 10000)
      const items = messages.items || []
      const filename = `session-${Date.now()}.${format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'}`
      if (format === 'json') {
        return { content: JSON.stringify(items, null, 2), format, filename }
      }
      if (format === 'markdown') {
        const lines = items.map((m: PiSessionMessage) => {
          const role = m.role || 'unknown'
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
          return `### ${role}\n\n${content}\n`
        })
        return { content: lines.join('\n---\n\n'), format, filename }
      }
      if (format === 'html') {
        const body = items
          .map((m: PiSessionMessage) => {
            const role = m.role || 'unknown'
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
            return `<div><strong>${role}</strong><p>${String(content).replace(/</g, '&lt;')}</p></div>`
          })
          .join('\n')
        return { content: `<!DOCTYPE html><html><body>${body}</body></html>`, format, filename }
      }
      return { content: '', format, filename, error: 'unsupported format' }
    } catch (e: unknown) {
      return { content: '', format, filename: 'export', error: errorMessage(e) }
    }
  })
}