import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { workerManager } from './worker-manager'
import { configStore } from './config-store'
import { sqliteIndex } from './sqlite-index'
import { readTrellisState } from './trellis-reader'
import { readPiInfo, readResourceList } from './pi-info'
import {
  listSkillsOnDisk,
  listPromptsOnDisk,
  readTextFileSafe,
  writeTextFileSafe,
  skillStorageKey,
} from './pi-resources-editor'
import {
  getDesktopSkillOverrides,
  isSkillEnabled,
  setSkillEnabledInGlobal,
  migrateElectronSkillOverrides,
} from './pi-skill-overrides'
import {
  listAgentsContextFiles,
  listPiBuiltinPromptFiles,
  listPluginInjectedPromptFiles,
  groupPromptCatalog,
  type PromptCatalogItem,
} from './pi-prompt-catalog'
import { listRevisions, pushRevision, restoreRevision, readRevision } from './resource-revisions'
import { probeExtensions } from '../extension-compat/extension-probe'
import { buildPluginAdapters, orphanV2Adapters } from '../extension-compat/plugin-adapters'
import { loadAdapterCatalog, resolveV2Slash } from '../extension-compat/adapter-loader'
import { readAdapterConfig, writeAdapterConfig, runAdapterAction, fetchFieldOptions } from '../extension-compat/adapter-backend'
import { execSync } from 'child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { pathToFileURL } from 'node:url'
const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
import { join, basename, dirname, extname } from 'path'
import { homedir } from 'os'
import {
  createSandboxWorkspace,
  listSandboxWorkspaces,
  renameSandboxWorkspace,
  deleteSandboxWorkspace,
  isSandboxWorkspacePath,
} from './sandbox-workspaces'
import {
  setPendingWorkerSessionFile,
  getPendingWorkerSessionFile,
  ensureWorkerSessionBound,
  setPendingEphemeralSandboxDraft,
} from './session-bind-state'
import { readGitWorkspaceSnapshot } from './git-workspace'
import { listMissingRuntimePackages, appendMissingGitPackagesToSettings } from './pi-packages-sync'
import { listRewindCheckpoints } from './pi-rewind-read'
import { listMessageAnchorsFromSessionFile } from './session-branch-anchors'
import { readSessionIdFromFile } from './session-file-meta'
import { flattenTreeFromSessionFile } from './session-tree-from-file'
import { resolveActiveSdk } from './sdk-loader'
import { readSdkStatus, listRegistryVersions, installVersion, switchTo } from './sdk-manager'

type HandlerFn = (request: any) => Promise<any>

const handlers = new Map<string, HandlerFn>()

/** 按当前生效 SDK（内置/全局/独立环境）动态 import SDK 模块。 */
function getActiveSdkModule(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const active = resolveActiveSdk(app.getPath('userData'))
  if (active.kind === 'builtin') {
    return import(active.entryPath)
  }
  return import(pathToFileURL(active.entryPath).href)
}

async function listSessionsOnDisk(workspaceId: string): Promise<any[]> {
  const { SessionManager } = await getActiveSdkModule()
  return await SessionManager.list(workspaceId)
}

export function registerHandler(channel: string, handler: HandlerFn): void {
  if (handlers.has(channel)) {
    ipcMain.removeHandler(channel)
  }
  handlers.set(channel, handler)
  ipcMain.handle(channel, async (_event, request) => {
    try {
      return await handler(request)
    } catch (error) {
      console.error(`[IPC:${channel}] Error:`, error)
      throw error
    }
  })
}

registerHandler('ipc:extension.respondUI', async (req) => {
  workerManager.respondExtensionUI(req)
  return { ok: true }
})

export function sendEvent(win: BrowserWindow, event: unknown): void {
  if (!win.isDestroyed()) {
    win.webContents.send('ipc:events', event)
  }
}

export function registerAllHandlers(): void {
  // ── Dialog ──
  registerHandler('ipc:extension.config.get', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { config: configStore.getExtensionConfig(workspaceId, req.extensionId) || {} }
  })

  registerHandler('ipc:extension.config.set', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    configStore.setExtensionConfig(workspaceId, req.extensionId, req.config || {})
    return { ok: true }
  })

  // ── Adapter Layer v2 (docs/adapter-layer-plan.md §6) — generic per-adapter config/action IPC ──
  registerHandler('ipc:adapter.config.get', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { view: readAdapterConfig(req.adapterId, workspaceId) }
  })
  registerHandler('ipc:adapter.config.set', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    return { view: writeAdapterConfig(req.adapterId, workspaceId, req.patch || {}) }
  })
  registerHandler('ipc:adapter.action.run', async (req) => {
    return runAdapterAction(req.adapterId, req.actionId)
  })
  registerHandler('ipc:adapter.field.options', async (req) => {
    return fetchFieldOptions(req.adapterId, req.fieldKey)
  })
  registerHandler('ipc:adapters.json.catalog', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || ''
    return loadAdapterCatalog(cwd)
  })

  registerHandler('ipc:dialog:openDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择项目目录' })
      : await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择项目目录' })
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null }
    }
    return { path: result.filePaths[0] }
  })

  registerHandler('ipc:dialog:openFiles', async (req) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const props: ('openFile' | 'multiSelections')[] = ['openFile']
    if (req?.multiple !== false) props.push('multiSelections')
    const opts = {
      properties: props,
      title: req?.title || '添加附件',
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) {
      return { paths: [] as string[] }
    }
    return { paths: result.filePaths }
  })

  // R1: open a local file/path in the OS default app or reveal in folder.
  // Used by preview_export / image_gen / studio_export tool cards.
  registerHandler('ipc:shell.openPath', async (req) => {
    const p = String(req.path || '')
    if (!p) return { ok: false }
    try { await shell.openPath(p); return { ok: true } } catch (e) { return { ok: false, error: String(e) } }
  })
  registerHandler('ipc:shell.showItemInFolder', async (req) => {
    const p = String(req.path || '')
    if (!p) return { ok: false }
    shell.showItemInFolder(p)
    return { ok: true }
  })
  registerHandler('ipc:shell.readImagePreview', async (req) => {
    const p = String(req.path || '')
    if (!p || !existsSync(p)) return { ok: false, error: 'not_found' }
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size > IMAGE_PREVIEW_MAX_BYTES) return { ok: false, error: 'too_large' }
      const ext = extname(p).toLowerCase()
      const mime =
        ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        ext === '.gif' ? 'image/gif' :
        ext === '.webp' ? 'image/webp' :
        ext === '.svg' ? 'image/svg+xml' :
        'application/octet-stream'
      const buf = readFileSync(p)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      return { ok: true, dataUrl, mimeType: mime }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Workspace ──
  registerHandler('ipc:workspace.open', async (req) => {
    const path = req.path
    const name = path.split(/[\\/]/).pop() || path
    // Update config immediately so UI and other IPCs (extensions, resources) work right away
    configStore.addRecentProject(path)
    configStore.set('currentProject', path)
    sqliteIndex.upsertWorkspace(path, name, path)
    // Start worker in the background (don't block the response)
    if (req.awaitWorker) {
      try {
        await workerManager.start(path)
      } catch (e) {
        console.error('[IPC] Worker start failed:', e)
        throw e
      }
    } else {
      workerManager.start(path).then((result) => {
        console.log('[IPC] Worker started for', path, result.sessionId)
      }).catch((e) => console.error('[IPC] Worker start failed:', e))
    }
    return { workspaceId: path, path, name }
  })

  registerHandler('ipc:workspace.switch', async (req) => {
    const result = await workerManager.start(req.workspaceId)
    return { workspaceId: req.workspaceId, path: req.workspaceId, name: req.workspaceId.split(/[\\/]/).pop(), ...result }
  })

  registerHandler('ipc:workspace.sandbox.create', async (req) => {
    const box = createSandboxWorkspace(req.label)
    return { sandbox: { ...box, kind: 'sandbox' as const } }
  })

  registerHandler('ipc:workspace.sandbox.list', async () => {
    return { sandboxes: listSandboxWorkspaces().map((s) => ({ ...s, kind: 'sandbox' as const })) }
  })

  registerHandler('ipc:workspace.sandbox.rename', async (req) => {
    const ok = renameSandboxWorkspace(req.path, req.label || '')
    return { ok }
  })

  registerHandler('ipc:workspace.sandbox.delete', async (req) => {
    const ok = deleteSandboxWorkspace(req.path)
    return { ok }
  })

  registerHandler('ipc:workspace.isSandbox', async (req) => {
    return { sandbox: isSandboxWorkspacePath(req.path || '') }
  })

  // ── Session ──
  registerHandler('ipc:session.list', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    const sessions = workspaceId ? await listSessionsOnDisk(workspaceId) : []
    const formatted = sessions.map((s: any) => ({
      sessionId: s.id,
      sessionFile: s.path,
      workspaceId: s.cwd || workspaceId,
      title: s.name || s.firstMessage?.slice(0, 60) || s.id.slice(0, 8),
      createdAt: s.created?.getTime() || 0,
      updatedAt: s.modified?.getTime() || 0,
      messageCount: s.messageCount || 0,
      modelId: '',
      status: 'idle' as const,
    }))
    return { sessions: formatted }
  })

  registerHandler('ipc:session.open', async (req) => {
    let sessionId = req.sessionId
    if (req.sessionFile) {
      setPendingWorkerSessionFile(req.sessionFile)
    }
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

  /** 切换会话时立即 loadSession，便于 Rewind 树 / ↩ / pi-rewind 与当前 JSONL 一致 */
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
      } catch { /* */ }
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
      (await workerManager.getState().catch(() => null) as { sessionFile?: string } | null)?.sessionFile
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
    const checkpoints = listRewindCheckpoints(cwd, sessionId || undefined)
    return { checkpoints }
  })

  registerHandler('ipc:rewind.runCommand', async (req) => {
    const text = String(req.text || '/rewind').trim()
    await workerManager.runExtensionCommand(text)
    return { ok: true }
  })

  registerHandler('ipc:session.getMessages', async (req) => {
    if (!req.sessionFile) return { items: [], totalCount: 0 }
    try {
      const offset = req.offset ?? 0
      const limit = req.limit ?? 0
      const r = await workerManager.getMessages(req.sessionFile, offset, limit || undefined)
      return { items: r.items, totalCount: r.totalCount, sessionMeta: r.sessionMeta }
    } catch (e) {
      console.error('[IPC] session.getMessages failed:', e)
      return { items: [], totalCount: 0 }
    }
  })

  registerHandler('ipc:session.new', async (req) => {
    const workspaceId = req.workspaceId || workerManager.cwd || configStore.get('currentProject') || ''
    if (!workspaceId) throw new Error('workspaceId is required')
    await workerManager.start(workspaceId)
    setPendingWorkerSessionFile(null)
    const result = await workerManager.newSession()
    const state = await workerManager.getState().catch(() => ({}))
    const sessionFile = (state as { sessionFile?: string })?.sessionFile
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

  registerHandler('ipc:session.fork', async (_req) => {
    // TODO: implement fork via runtime
    return { session: { sessionId: 'fork-stub', workspaceId: '', title: 'Fork', createdAt: 0, updatedAt: 0, modelId: '', status: 'idle' as const } }
  })

  registerHandler('ipc:session.clone', async (_req) => {
    return { session: { sessionId: 'clone-stub', workspaceId: '', title: 'Clone', createdAt: 0, updatedAt: 0, modelId: '', status: 'idle' as const } }
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
    const r = await workerManager.renameSessionFile(file, title)
    return { ok: !!r.ok, title, error: r.error }
  })

  registerHandler('ipc:session.delete', async (req) => {
    const file = req.sessionFile as string | undefined
    if (!file) return { ok: false, error: 'missing sessionFile' }
    const r = await workerManager.deleteSessionFile(file)
    return { ok: !!r.ok, error: r.error }
  })

  registerHandler('ipc:session.compact', async (_req) => {
    // TODO: trigger compaction
    return { sessionId: '', compacted: false, tokensSaved: 0 }
  })

  registerHandler('ipc:session.export', async (req) => {
    // TODO: export session
    return { content: '', format: req.format, filename: 'export' }
  })

  // ── Prompt ──
  const bindBeforePrompt = async () => {
    await ensureWorkerSessionBound((f) => workerManager.loadSession(f))
  }

  registerHandler('ipc:prompt.send', async (req) => {
    await bindBeforePrompt()
    await workerManager.sendPrompt(req.text)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.sendWithImages', async (req) => {
    await bindBeforePrompt()
    await workerManager.sendPromptWithImages(req.text, req.images)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.steer', async (req) => {
    await bindBeforePrompt()
    await workerManager.steer(req.text)
    return { steered: true }
  })

  registerHandler('ipc:prompt.followUp', async (req) => {
    await bindBeforePrompt()
    await workerManager.followUp(req.text)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.abort', async (_req) => {
    await workerManager.abort()
    return { aborted: true }
  })

  /** 清空 pi 侧 steer/follow-up 队列并返回文案（对齐 TUI Alt+↑ / app.message.dequeue） */
  registerHandler('ipc:prompt.dequeueClearQueue', async (req) => {
    const abort = !!req?.abort
    const currentText = typeof req?.currentText === 'string' ? req.currentText : ''
    const cleared = await workerManager.clearPromptQueue()
    const all = [...(cleared.steering || []), ...(cleared.followUp || [])]
    const queuedText = all.join('\n\n')
    const combined = [queuedText, currentText.trim()].filter(Boolean).join('\n\n')
    if (abort) await workerManager.abort()
    return { restoredCount: all.length, combinedText: combined }
  })

  // ── Model ──
  registerHandler('ipc:model.list', async (_req) => {
    // Authoritative source = Worker session modelRegistry
    if (workerManager.isRunning) {
      try {
        const models = await workerManager.getModels()
        return { models }
      } catch (e) {
        console.error('[IPC] model.list worker failed:', e)
      }
    }
    // Fallback: standalone ModelRegistry in main (may return empty if auth not loaded)
    try {
      const { ModelRegistry, AuthStorage } = await getActiveSdkModule()
      const auth = AuthStorage.create()
      const registry = ModelRegistry.create(auth)
      const models = await registry.getAvailable()
      return {
        models: models.map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          provider: m.provider,
          contextWindow: m.contextWindow || 0,
          maxOutput: m.maxOutput || 0,
          available: true,
        })),
      }
    } catch (e) {
      console.error('[IPC] model.list failed:', e)
      return { models: [] }
    }
  })

  registerHandler('ipc:model.set', async (req) => {
    let provider: string
    let modelId: string
    if (req.provider && req.modelId) {
      provider = req.provider
      modelId = req.modelId
    } else {
      const raw = req.modelId || ''
      if (raw.includes('/')) {
        ;[provider, modelId] = raw.split('/') as [string, string]
      } else {
        provider = 'anthropic'
        modelId = raw
      }
    }
    await workerManager.setModel(provider, modelId)
    return { modelId: `${provider}/${modelId}` }
  })

  registerHandler('ipc:model.cycle', async (_req) => {
    // TODO: implement via session.cycleModel
    return { modelId: '', thinkingLevel: 'medium' }
  })

  // ── ThinkingLevel ──
  registerHandler('ipc:thinkingLevel.set', async (req) => {
    await workerManager.setThinkingLevel(req.level)
    return { level: req.level }
  })

  registerHandler('ipc:runtime.getState', async () => {
    if (!workerManager.isRunning) return { state: null }
    const state = await workerManager.getState()
    return { state }
  })

  registerHandler('ipc:context.preview', async () => {
    if (!workerManager.isRunning) return { preview: null }
    try {
      const preview = await workerManager.getSessionContextPreview()
      return { preview }
    } catch (e) {
      console.error('[IPC] context.preview failed:', e)
      return { preview: null }
    }
  })

  registerHandler('ipc:intercom.snapshot', async () => {
    const agentDir = join(homedir(), '.pi', 'agent')
    const intercomDir = join(agentDir, 'intercom')
    const configPath = join(intercomDir, 'config.json')
    let config: Record<string, unknown> | null = null
    try {
      if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch { /* ignore */ }
    const notes: string[] = []
    if (existsSync(intercomDir)) notes.push(`目录: ${intercomDir}`)
    else notes.push('未找到 ~/.pi/agent/intercom（扩展可能未启用 broker）')
    notes.push('完整收件箱需 pi-intercom broker 运行；桌面仅只读配置与路径说明。')
    return { config, notes, intercomDir: existsSync(intercomDir) ? intercomDir : null }
  })

  registerHandler('ipc:skills.list', async () => {
    const legacy = configStore.getSkillOverrides()
    if (legacy && Object.keys(legacy).length > 0) {
      migrateElectronSkillOverrides(legacy)
      configStore.set('skillOverrides', {})
    }
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const overrides = getDesktopSkillOverrides()
    const disk = listSkillsOnDisk(cwd)
    let worker: any[] = []
    if (workerManager.isRunning) {
      try {
        worker = await workerManager.getSkillsList()
      } catch (e) {
        console.error('[IPC] skills.list worker failed:', e)
      }
    }
    const byPath = new Map<string, any>()
    for (const s of disk) {
      const key = skillStorageKey(s.name, s.path)
      byPath.set(s.path, {
        ...s,
        key,
        enabled: isSkillEnabled(s.name, s.path, overrides),
        command: `/skill:${s.name}`,
      })
    }
    for (const s of worker) {
      const path = s.path || ''
      const key = skillStorageKey(s.name, path || undefined)
      const existing = path ? byPath.get(path) : undefined
      const row = {
        name: s.name,
        description: s.description || existing?.description || '',
        path: path || existing?.path,
        source: s.source || existing?.source || 'unknown',
        key,
        enabled: isSkillEnabled(s.name, path || existing?.path, overrides),
        command: `/skill:${s.name}`,
        fromWorker: true,
      }
      if (path) byPath.set(path, { ...existing, ...row })
      else if (![...byPath.values()].some((x) => x.name === s.name)) {
        byPath.set(`worker:${s.name}`, row)
      }
    }
    return { skills: [...byPath.values()] }
  })

  registerHandler('ipc:skills.setEnabled', async (req) => {
    const name = String(req.name || '')
    const path = req.path ? String(req.path) : undefined
    const enabled = req.enabled !== false
    if (!name && !path) return { ok: false }
    const overrides = setSkillEnabledInGlobal(name || 'unknown', path, enabled)
    const key = skillStorageKey(name, path)
    if (workerManager.isRunning) {
      await workerManager.reloadResources().catch(() => {})
    }
    return { ok: true, key, enabled: isSkillEnabled(name, path, overrides) }
  })

  registerHandler('ipc:prompts.list', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    let projectTrusted = true
    let defaultSystemPreview = ''
    if (workerManager.isRunning) {
      try {
        const ctx = await workerManager.getContextPrompts()
        projectTrusted = ctx.projectTrusted !== false
        defaultSystemPreview = String(ctx.builtSystemPreview || '')
      } catch {
        /* */
      }
    }

    const byPath = new Map<string, PromptCatalogItem>()
    const push = (item: PromptCatalogItem) => {
      const k = item.path?.toLowerCase() || item.id
      if (!byPath.has(k)) byPath.set(k, item)
    }

    for (const a of listAgentsContextFiles(cwd)) push(a)
    for (const b of listPiBuiltinPromptFiles(cwd, projectTrusted)) {
      if (b.id === 'builtin:system:default' && defaultSystemPreview) {
        push({ ...b, description: '当前会话实际组装的 system 提示词（只读预览）' })
      } else push(b)
    }
    for (const plug of listPluginInjectedPromptFiles(cwd)) push(plug)

    const disk = listPromptsOnDisk(cwd)
    const tplByPath = new Map<string, (typeof disk)[0]>()
    for (const p of disk) tplByPath.set(p.path, p)
    if (workerManager.isRunning) {
      try {
        const worker = await workerManager.getPromptTemplatesList()
        for (const t of worker) {
          const path = t.path || ''
          if (path && tplByPath.has(path)) {
            const cur = tplByPath.get(path)!
            tplByPath.set(path, { ...cur, description: t.description || cur.description })
          } else if (path) {
            tplByPath.set(path, {
              name: t.name,
              description: t.description || '',
              path,
              source: (t.source as any) || 'unknown',
              command: `/${t.name}`,
            })
          }
        }
      } catch (e) {
        console.error('[IPC] prompts.list templates worker failed:', e)
      }
    }
    for (const p of tplByPath.values()) {
      push({
        id: `template:${p.path}`,
        category: 'prompt_template',
        name: p.name,
        description: p.description,
        path: p.path,
        command: p.command,
        source: p.source,
        editable: true,
        inSystemContext: false,
      })
    }

    const prompts = [...byPath.values()]
    return {
      prompts,
      groups: groupPromptCatalog(prompts),
      defaultSystemPreview,
      virtualSystemPreviewPath: 'pi-desktop://system-prompt-preview',
    }
  })

  registerHandler('ipc:resource.read', async (req) => {
    const path = String(req.path || '')
    if (!path) return { error: 'missing path' }
    if (path === 'pi-desktop://system-prompt-preview') {
      try {
        if (!workerManager.isRunning) {
          return { content: '（Worker 未启动，打开工作区后重试）', path, revisions: [] }
        }
        const ctx = await workerManager.getContextPrompts()
        return {
          content: String(ctx.builtSystemPreview || '（空）'),
          path,
          revisions: [],
        }
      } catch (e: any) {
        return { error: e.message }
      }
    }
    try {
      const { content, path: resolved } = readTextFileSafe(path)
      return { content, path: resolved, revisions: listRevisions(resolved) }
    } catch (e: any) {
      return { error: e.message }
    }
  })

  registerHandler('ipc:resource.write', async (req) => {
    const path = String(req.path || '')
    if (path.startsWith('pi-desktop://')) return { ok: false, error: '只读预览不可保存' }
    const content = String(req.content ?? '')
    if (!path) return { ok: false, error: 'missing path' }
    try {
      pushRevision(path, req.revisionLabel || '保存前')
      writeTextFileSafe(path, content)
      if (workerManager.isRunning) {
        await workerManager.reloadResources().catch(() => {})
      }
      return { ok: true, revisions: listRevisions(path) }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  registerHandler('ipc:resource.revisions', async (req) => {
    const path = String(req.path || '')
    return { revisions: path ? listRevisions(path) : [] }
  })

  registerHandler('ipc:resource.restore', async (req) => {
    const path = String(req.path || '')
    const revisionId = String(req.revisionId || '')
    if (!path || !revisionId) return { ok: false }
    try {
      restoreRevision(path, revisionId)
      if (workerManager.isRunning) await workerManager.reloadResources().catch(() => {})
      const { content } = readTextFileSafe(path)
      return { ok: true, content, revisions: listRevisions(path) }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  registerHandler('ipc:resource.revision.read', async (req) => {
    try {
      const content = readRevision(String(req.path), String(req.revisionId))
      return { content }
    } catch (e: any) {
      return { error: e.message }
    }
  })

  registerHandler('ipc:commands.completions', async (req) => {
    if (!workerManager.isRunning) return { items: [] }
    try {
      const items = await workerManager.getCommandCompletions(req.commandName, req.argumentPrefix || '')
      return { items }
    } catch (e) {
      console.error('[IPC] commands.completions failed:', e)
      return { items: [] }
    }
  })

  // ── Commands ──
  // Authoritative source = Worker session getCommands (A-layer, tui-replacement-and-adapters.md §2.2).
  // Directory scan is a fallback ONLY when Worker not started yet.
  registerHandler('ipc:commands.list', async (_req) => {
    if (workerManager.isRunning) {
      try {
        const r = await workerManager.getCommands()
        const overrides = getDesktopSkillOverrides()
        const commands = (r.commands || []).filter((c: any) => {
          if (c.category !== 'skill') return true
          const id = String(c.id || c.name || '').replace(/^\/?skill:/, '')
          const path = c.source?.path || c.source?.filePath
          return isSkillEnabled(id, path, overrides)
        })
        return { commands, source: 'worker' }
      } catch (e) {
        console.error('[IPC] commands.list worker failed:', e)
      }
    }

    // Fallback: static scan (Worker not started). NOT authoritative for execution.
    const commands: any[] = []
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const projectPromptsDir = join(cwd, '.pi', 'prompts')
    if (existsSync(projectPromptsDir)) {
      try {
        for (const file of readdirSync(projectPromptsDir)) {
          if (file.endsWith('.md')) {
            const name = file.replace('.md', '')
            commands.push({ id: name, name: `/prompt:${name}`, description: 'Project prompt', category: 'prompt' })
          }
        }
      } catch {}
    }
    const projectSkillsDir = join(cwd, '.pi', 'skills')
    if (existsSync(projectSkillsDir)) {
      try {
        for (const dir of readdirSync(projectSkillsDir)) {
          const skillFile = join(projectSkillsDir, dir, 'SKILL.md')
          if (existsSync(skillFile)) {
            commands.push({ id: dir, name: `/skill:${dir}`, description: 'Project skill', category: 'skill' })
          }
        }
      } catch {}
    }
    return { commands, source: 'fallback' }
  })

  // ── Review ──
  registerHandler('ipc:review.getDiff', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    if (req.scope === 'git') {
      const snap = readGitWorkspaceSnapshot(cwd)
      return {
        diff: {
          raw: snap.raw,
          status: snap.status,
          scope: 'git',
          branch: snap.branch,
          log: snap.log,
          isRepo: snap.isRepo,
          message: snap.message,
        },
      }
    }
    return { diff: { raw: '', status: '', scope: req.scope, isRepo: true } }
  })

  // ── Trellis ──
  registerHandler('ipc:trellis.getState', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    return readTrellisState(cwd)
  })

  // ── Extensions ──
  registerHandler('ipc:extensions.list', async (_req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const probes = probeExtensions(cwd)
    return { extensions: probes }
  })

  registerHandler('ipc:extensions.setOverride', async (req) => {
    configStore.setExtensionOverride(req.extensionId, req.enabled)
    return { extensionId: req.extensionId, enabled: req.enabled }
  })

  registerHandler('ipc:extensions.missingRuntimePackages', async () => {
    return { missing: listMissingRuntimePackages() }
  })

  registerHandler('ipc:extensions.syncGitPackages', async () => {
    const result = appendMissingGitPackagesToSettings()
    const cwd = workerManager.cwd || configStore.get('currentProject')
    if (result.added.length > 0 && cwd) {
      try {
        await workerManager.stop()
        await workerManager.start(cwd)
      } catch (e) {
        console.error('[IPC] Worker restart after package sync failed:', e)
      }
    }
    return result
  })

  registerHandler('ipc:adapters.catalog', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const extensions = probeExtensions(cwd)
    const probed = buildPluginAdapters(extensions, cwd)
    // Append v2-only adapters not matched by any probed plugin so the list is complete.
    const orphans = orphanV2Adapters(extensions, cwd).map((a) => ({
      id: a.id,
      displayName: a.displayName || a.id,
      pluginId: a.id,
      packageName: a.id,
      source: 'package',
      description: a.description,
      registeredTools: a.match?.tools || [],
      registeredCommands: Object.keys(a.slash || {}),
      enabled: true,
      tier: a.tier,
      compatibility: a.tier === 'native' ? 'native' : a.tier === 'partial' ? 'basic' : 'headless',
      desktopSupport: a.description || '',
      adapterJson: a,
      matchMeta: { probeId: `adapter.json:${a.id}` },
    }))
    return { adapters: [...probed, ...orphans] }
  })

  // B-layer: resolve slash command desktop behavior (notify vs config-page vs execute) — v2-only
  registerHandler('ipc:slash.resolve', async (req) => {
    const r = resolveV2Slash(req.command || '')
    if (!r) return { behavior: 'passthrough', meta: null }
    return { behavior: r.behavior, meta: { matchNames: r.matchNames, desktopSupport: r.desktopSupport } }
  })

  // ── Registry ──
  registerHandler('ipc:registry.refresh', async (req) => {
    // TODO: fetch remote registry
    return { refreshed: false, count: 0 }
  })

  // ── Settings ──
  registerHandler('ipc:settings.get', async (req) => {
    if (req.key) {
      return { settings: { [req.key]: configStore.get(req.key as any) } }
    }
    return { settings: configStore.getAll() }
  })

  registerHandler('ipc:settings.set', async (req) => {
    configStore.set(req.key as any, req.value)
    return { key: req.key, value: req.value }
  })

  // ── Pi Info ──
  registerHandler('ipc:pi.getInfo', async () => {
    return readPiInfo()
  })

  // ── SDK 升级 / 切换 / 回退 ──
  registerHandler('ipc:sdk.status', async () => {
    const status = readSdkStatus(app.getPath('userData'))
    status.workerFallback = workerManager.lastSdkFallback
    return status
  })

  registerHandler('ipc:sdk.listAvailable', async () => {
    return await listRegistryVersions()
  })

  registerHandler('ipc:sdk.install', async (req) => {
    const version = String(req?.version || '').trim()
    if (!version) return { ok: false, error: 'missing version' }
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    try {
      await installVersion(version, (line) => {
        if (win) sendEvent(win, { type: 'sdk-install-progress', version, line })
      })
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true })
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (cwd) {
        await workerManager.stop()
        await workerManager.start(cwd)
      }
      return { ok: true }
    } catch (e: any) {
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true, error: e.message })
      return { ok: false, error: e.message }
    }
  })

  registerHandler('ipc:sdk.switch', async (req) => {
    const target: 'builtin' | 'global' | 'user' =
      req?.target === 'global' ? 'global' : req?.target === 'user' ? 'user' : 'builtin'
    try {
      await switchTo(target)
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (cwd) {
        await workerManager.stop()
        await workerManager.start(cwd)
      }
      return { ok: true, active: target }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── Pi Settings (A-layer write-back, tui-replacement-and-adapters.md §2.5) ──
  registerHandler('ipc:pi.settings.get', async () => {
    if (!workerManager.isRunning) return { settings: null, error: 'Worker not started' }
    try {
      const settings = await workerManager.getPiSettings()
      return { settings }
    } catch (e: any) {
      return { settings: null, error: e.message }
    }
  })

  registerHandler('ipc:pi.settings.set', async (req) => {
    try {
      await workerManager.setPiSettings(req.patch || {})
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── Resources ──
  registerHandler('ipc:resources.list', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    return readResourceList(cwd)
  })
}
