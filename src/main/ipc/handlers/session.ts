import { configStore } from '../../config-store'
import { workerManager } from '../../worker-manager'
import { listRewindCheckpoints } from '../../pi-rewind-read'
import { listMessageAnchorsFromSessionFile } from '../../session-branch-anchors'
import { readSessionIdFromFile } from '../../session-file-meta'
import { clearSessionDisplayName, resolveSessionListTitle } from '../../session-display-names'
import { renamePiSessionOnDisk } from '../../rename-pi-session'
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
        s.firstMessage?.slice(0, 60) || s.id.slice(0, 8),
        s.name,
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
      // 禁止 force：后台 agent 仍在跑时不得 dispose 旧 session
      const r = await workerManager.loadSession(sessionFile)
      setPendingWorkerSessionFile(null)
      return {
        bound: true,
        sessionId: r.sessionId,
        model: r.model,
        thinkingLevel: r.thinkingLevel,
        modelFallbackMessage: r.modelFallbackMessage,
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
    if (sessionFile) {
      try {
        const { getSessionLeafOverride } = await import('../../session-leaf-override.js')
        leafOverride = getSessionLeafOverride(sessionFile)
      } catch {
        /* ignore */
      }
    }
    if (workerManager.isRunning) {
      try {
        const st = sessionFile
          ? await workerManager.getState(sessionFile).catch(() => null)
          : await workerManager.getState().catch(() => null)
        workerSessionFile = (st as { sessionFile?: string } | null)?.sessionFile
        if (!sessionFile) sessionFile = workerSessionFile
        if (leafOverride === undefined && st && 'leafId' in (st || {})) {
          leafOverride = ((st as { leafId?: string | null }).leafId) ?? null
        }
      } catch {
        /* disk tree still works */
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
      // Bind the *requested* session worker, then navigate on that same slot.
      // Passing sessionFile through avoids foreground-fallback / wrong-worker races.
      // Pass explicit cwd so rewind works after cold open without a pre-started Worker.
      await ensureWorkerSessionBound(
        (f, o) =>
          workerManager.loadSession(f, {
            force: o?.force,
            cwd: workerManager.resolveWorkspaceCwd() || undefined,
          }),
        { sessionFile: req.sessionFile },
      )
      const result = await workerManager.navigateTree(req.targetId, {
        summarize: req.summarize === true,
        label: req.label,
        sessionFile: req.sessionFile,
      })
      // Persist leaf tip for disk getMessages / next loadSession (pi does not write leaf to JSONL).
      if (!result.cancelled && req.sessionFile) {
        const { setSessionLeafOverride } = await import('../../session-leaf-override.js')
        const leaf =
          result.leafId !== undefined && result.leafId !== null
            ? result.leafId
            : req.targetId
        setSessionLeafOverride(req.sessionFile, leaf)
      }
      return result
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
    // Disk-first timeline preview. NEVER spawn/ensure a worker just to read history —
    // that was the main cause of slow session switches (loadSession + dispose thrash).
    try {
      const { getSessionLeafOverride } = await import('../../session-leaf-override.js')
      let leafId: string | null | undefined =
        typeof req.leafId === 'string'
          ? req.leafId
          : req.leafId === null
            ? null
            : getSessionLeafOverride(req.sessionFile)

      // If a live worker already has this session, prefer its leaf when no override.
      if (leafId === undefined) {
        try {
          const st = await workerManager.getState(req.sessionFile)
          if (st && 'leafId' in st && (st as { leafId?: string | null }).leafId != null) {
            leafId = (st as { leafId?: string | null }).leafId ?? null
          }
        } catch {
          /* ignore — disk path below */
        }
      }

      const { getSessionMessagesFromDisk } = await import('../../session-messages-from-disk.js')
      const disk = await getSessionMessagesFromDisk(
        req.sessionFile,
        offset,
        limit || undefined,
        leafId,
      )
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
    const sessionFile =
      result.sessionFile || (state as { sessionFile?: string })?.sessionFile
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
    const entryId = String(req?.entryId || req?.fromMessageId || '').trim()
    const sessionFile = String(req?.sessionFile || '').trim()
    const workspaceId = String(req?.workspaceId || workerManager.cwd || configStore.get('currentProject') || '')
    try {
      if (!entryId) {
        return {
          cancelled: false,
          error: 'missing entryId',
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Fork',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'missing entryId',
          },
        }
      }
      if (!sessionFile) {
        return {
          cancelled: false,
          error: 'missing sessionFile',
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Fork',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'missing sessionFile',
          },
        }
      }
      const result = await workerManager.forkSession({
        sessionFile,
        entryId,
        position: req?.position === 'at' ? 'at' : 'before',
      })
      if (result.error) {
        return {
          cancelled: false,
          error: result.error,
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Fork',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: result.error,
          },
        }
      }
      if (result.cancelled) {
        return {
          cancelled: true,
          session: {
            sessionId: result.sessionId || '',
            sessionFile: result.sessionFile,
            workspaceId,
            title: title || 'Fork',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            modelId: '',
            status: 'idle' as const,
          },
        }
      }
      setPendingWorkerSessionFile(null)
      return {
        cancelled: false,
        editorText: result.editorText,
        sessionId: result.sessionId,
        sessionFile: result.sessionFile,
        workspaceId,
        session: {
          sessionId: result.sessionId || '',
          sessionFile: result.sessionFile,
          workspaceId,
          title: title || 'Fork',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modelId: result.model || '',
          status: 'idle' as const,
        },
      }
    } catch (e: unknown) {
      return {
        cancelled: false,
        error: errorMessage(e),
        session: {
          sessionId: '',
          workspaceId,
          title: title || 'Fork',
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
    const sessionFile = String(req?.sessionFile || '').trim()
    const workspaceId = String(req?.workspaceId || workerManager.cwd || configStore.get('currentProject') || '')
    try {
      if (!sessionFile) {
        return {
          cancelled: false,
          error: 'missing sessionFile',
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Clone',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: 'missing sessionFile',
          },
        }
      }
      const result = await workerManager.cloneSession({ sessionFile })
      if (result.error) {
        return {
          cancelled: false,
          error: result.error,
          session: {
            sessionId: '',
            workspaceId,
            title: title || 'Clone',
            createdAt: 0,
            updatedAt: 0,
            modelId: '',
            status: 'idle' as const,
            error: result.error,
          },
        }
      }
      if (result.cancelled) {
        return {
          cancelled: true,
          session: {
            sessionId: result.sessionId || '',
            sessionFile: result.sessionFile,
            workspaceId,
            title: title || 'Clone',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            modelId: '',
            status: 'idle' as const,
          },
        }
      }
      setPendingWorkerSessionFile(null)
      return {
        cancelled: false,
        sessionId: result.sessionId,
        sessionFile: result.sessionFile,
        workspaceId,
        session: {
          sessionId: result.sessionId || '',
          sessionFile: result.sessionFile,
          workspaceId,
          title: title || 'Clone',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modelId: result.model || '',
          status: 'idle' as const,
        },
      }
    } catch (e: unknown) {
      return {
        cancelled: false,
        error: errorMessage(e),
        session: {
          sessionId: '',
          workspaceId,
          title: title || 'Clone',
          createdAt: 0,
          updatedAt: 0,
          modelId: '',
          status: 'idle' as const,
          error: errorMessage(e),
        },
      }
    }
  })

  registerHandler('ipc:session.forkCandidates', async (req) => {
    const sessionFile = String(req?.sessionFile || '').trim()
    try {
      if (!sessionFile) return { messages: [] }
      const messages = await workerManager.getForkMessages(sessionFile)
      return { messages }
    } catch (e: unknown) {
      return { messages: [], error: errorMessage(e) }
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
    const workspaceCwd =
      (req.workspaceId as string | undefined) ||
      workerManager.cwd ||
      configStore.get('currentProject') ||
      undefined
    const r = await renamePiSessionOnDisk(file, title, workspaceCwd)
    if (!r.ok) return { ok: false, title, error: r.error || 'rename failed' }
    clearSessionDisplayName(file)
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