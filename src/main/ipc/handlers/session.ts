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
import { listSessionsOnDisk } from '../sdk-session'
import { registerHandler } from '../registry'

export function registerSessionHandlers(): void {
  registerHandler('ipc:session.list', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    const sessions = workspaceId ? await listSessionsOnDisk(workspaceId) : []
    const formatted = sessions.map((s: any) => ({
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

  registerHandler('ipc:session.prepare', async (req) => {
    const sessionFile = req.sessionFile as string | undefined
    if (!sessionFile) {
      setPendingWorkerSessionFile(null)
      return { bound: false, sessionId: null as string | null }
    }
    try {
      const r = await workerManager.loadSession(sessionFile)
      setPendingWorkerSessionFile(null)
      return { bound: true, sessionId: r.sessionId, model: r.model, thinkingLevel: (r as any).thinkingLevel }
    } catch (e: any) {
      setPendingWorkerSessionFile(sessionFile)
      return { bound: false, sessionId: readSessionIdFromFile(sessionFile), error: e.message }
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
    if (!sessionFile) sessionFile = getPendingWorkerSessionFile() || undefined
    if (!sessionFile) {
      const st = await workerManager.getState().catch(() => null)
      sessionFile = (st as { sessionFile?: string } | null)?.sessionFile
    }
    let leafOverride: string | null | undefined
    if (sessionFile && workerManager.isRunning) {
      try {
        const st = await workerManager.getState()
        if (st?.sessionFile === sessionFile && 'leafId' in st) {
          leafOverride = st.leafId ?? null
        }
      } catch {
        /* */
      }
    }
    if (sessionFile) {
      try {
        const r = await flattenTreeFromSessionFile(sessionFile, cwd, leafOverride ?? undefined)
        return { nodes: r.nodes, leafId: r.leafId, workerBound: !!workerManager.isRunning }
      } catch (e: any) {
        return { nodes: [], leafId: null, error: e.message }
      }
    }
    try {
      const p = workerManager.getSessionTree()
      const timeout = new Promise<{ nodes: []; leafId: null; error: string }>((resolve) =>
        setTimeout(() => resolve({ nodes: [], leafId: null, error: 'timeout' }), 15000),
      )
      return await Promise.race([p, timeout])
    } catch (e: any) {
      return { nodes: [], leafId: null, error: e.message }
    }
  })

  registerHandler('ipc:session.navigateTree', async (req) => {
    const targetId = String(req.targetId || '')
    if (!targetId) return { cancelled: true, error: 'missing targetId' }
    try {
      await ensureWorkerSessionBound((f) => workerManager.loadSession(f))
      return await workerManager.navigateTree(targetId, {
        summarize: req.summarize === true,
        label: req.label,
      })
    } catch (e: any) {
      return { cancelled: true, error: e.message }
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

  registerHandler('ipc:session.getMessages', async (req) => {
    if (!req.sessionFile) return { items: [], totalCount: 0 }
    if (!workerManager.isRunning) {
      return { items: [], totalCount: 0, error: 'worker_not_ready' }
    }
    try {
      const offset = req.offset ?? 0
      const limit = req.limit ?? 0
      const r = await workerManager.getMessages(req.sessionFile, offset, limit || undefined)
      return { items: r.items, totalCount: r.totalCount, sessionMeta: r.sessionMeta }
    } catch (e: any) {
      console.error('[IPC] session.getMessages failed:', e)
      return { items: [], totalCount: 0, error: e?.message || 'get_messages_failed' }
    }
  })

  registerHandler('ipc:session.new', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    if (!workspaceId) throw new Error('workspaceId is required')
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

  registerHandler('ipc:session.fork', async () => ({
    session: {
      sessionId: 'fork-stub',
      workspaceId: '',
      title: 'Fork',
      createdAt: 0,
      updatedAt: 0,
      modelId: '',
      status: 'idle' as const,
    },
  }))

  registerHandler('ipc:session.clone', async () => ({
    session: {
      sessionId: 'clone-stub',
      workspaceId: '',
      title: 'Clone',
      createdAt: 0,
      updatedAt: 0,
      modelId: '',
      status: 'idle' as const,
    },
  }))

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

  registerHandler('ipc:session.delete', async (req) => {
    const file = req.sessionFile as string | undefined
    if (!file) return { ok: false, error: 'missing sessionFile' }
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
    } catch (e: any) {
      return { ok: false, error: e?.message || 'reload failed' }
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

  registerHandler('ipc:session.compact', async () => ({
    sessionId: '',
    compacted: false,
    tokensSaved: 0,
  }))

  registerHandler('ipc:session.export', async (req) => ({
    content: '',
    format: req.format,
    filename: 'export',
  }))
}