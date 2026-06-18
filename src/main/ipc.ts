import { ipcMain, dialog, BrowserWindow } from 'electron'
import { workerManager } from './worker-manager'
import { configStore } from './config-store'
import { sqliteIndex } from './sqlite-index'
import { readTrellisState } from './trellis-reader'
import { readPiInfo, readResourceList } from './pi-info'
import { probeExtensions } from '../extension-compat/extension-probe'
import { execSync } from 'child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'

type HandlerFn = (request: any) => Promise<any>

const handlers = new Map<string, HandlerFn>()

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

export function sendEvent(win: BrowserWindow, event: unknown): void {
  if (!win.isDestroyed()) {
    win.webContents.send('ipc:events', event)
  }
}

export function registerAllHandlers(): void {
  // ── Dialog ──
  registerHandler('ipc:dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择项目目录',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null }
    }
    return { path: result.filePaths[0] }
  })

  // ── Workspace ──
  registerHandler('ipc:workspace.open', async (req) => {
    const result = await workerManager.start(req.path)
    configStore.addRecentProject(req.path)
    configStore.set('currentProject', req.path)
    const name = req.path.split(/[\\/]/).pop() || req.path
    sqliteIndex.upsertWorkspace(req.path, name, req.path)
    return { workspaceId: req.path, path: req.path, name, ...result }
  })

  registerHandler('ipc:workspace.switch', async (req) => {
    const result = await workerManager.start(req.workspaceId)
    return { workspaceId: req.workspaceId, path: req.workspaceId, name: req.workspaceId.split(/[\\/]/).pop(), ...result }
  })

  // ── Session ──
  registerHandler('ipc:session.list', async (req) => {
    const sessions = await workerManager.listSessions(req.workspaceId)
    const formatted = sessions.map((s: any) => ({
      sessionId: s.id,
      workspaceId: s.cwd || workerManager.cwd || '',
      title: s.name || s.firstMessage?.slice(0, 60) || s.id.slice(0, 8),
      createdAt: s.created?.getTime() || 0,
      updatedAt: s.modified?.getTime() || 0,
      modelId: '',
      status: 'idle' as const,
    }))
    return { sessions: formatted }
  })

  registerHandler('ipc:session.open', async (req) => {
    // For now, just return a stub - opening a specific session requires restarting worker with that session
    return { session: { sessionId: req.sessionId, workspaceId: workerManager.cwd || '', title: '', createdAt: 0, updatedAt: 0, modelId: '', status: 'idle' as const } }
  })

  registerHandler('ipc:session.new', async (req) => {
    const result = await workerManager.newSession()
    return { session: { sessionId: result.sessionId, workspaceId: req.workspaceId, title: 'New Session', createdAt: Date.now(), updatedAt: Date.now(), modelId: '', status: 'idle' as const } }
  })

  registerHandler('ipc:session.fork', async (_req) => {
    // TODO: implement fork via runtime
    return { session: { sessionId: 'fork-stub', workspaceId: '', title: 'Fork', createdAt: 0, updatedAt: 0, modelId: '', status: 'idle' as const } }
  })

  registerHandler('ipc:session.clone', async (_req) => {
    return { session: { sessionId: 'clone-stub', workspaceId: '', title: 'Clone', createdAt: 0, updatedAt: 0, modelId: '', status: 'idle' as const } }
  })

  registerHandler('ipc:session.rename', async (req) => {
    // TODO: implement via session manager
    return { session: { sessionId: req.sessionId, workspaceId: '', title: req.title, createdAt: 0, updatedAt: Date.now(), modelId: '', status: 'idle' as const } }
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
  registerHandler('ipc:prompt.send', async (req) => {
    await workerManager.sendPrompt(req.text)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.sendWithImages', async (req) => {
    await workerManager.sendPromptWithImages(req.text, req.images)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.steer', async (req) => {
    await workerManager.steer(req.text)
    return { steered: true }
  })

  registerHandler('ipc:prompt.followUp', async (req) => {
    await workerManager.followUp(req.text)
    return { messageId: `msg-${Date.now()}` }
  })

  registerHandler('ipc:prompt.abort', async (_req) => {
    await workerManager.abort()
    return { aborted: true }
  })

  // ── Model ──
  registerHandler('ipc:model.list', async (_req) => {
    // Read available models from ModelRegistry
    try {
      const { ModelRegistry, AuthStorage } = await import('@earendil-works/pi-coding-agent')
      const auth = AuthStorage.create()
      const registry = ModelRegistry.create(auth)
      const models = registry.listAvailable()
      return {
        models: models.map((m: any) => ({
          id: `${m.provider}/${m.modelId}`,
          name: m.name || m.modelId,
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
    const [provider, modelId] = req.modelId.includes('/') ? req.modelId.split('/') : ['anthropic', req.modelId]
    await workerManager.setModel(provider, modelId)
    return { modelId: req.modelId }
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

  // ── Commands ──
  registerHandler('ipc:commands.list', async (_req) => {
    // Read slash commands from prompts and skills
    const commands: any[] = []
    const agentDir = join(homedir(), '.pi', 'agent')
    const cwd = workerManager.cwd || process.cwd()

    // Check project prompts
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

    // Check project skills
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

    return { commands }
  })

  // ── Review ──
  registerHandler('ipc:review.getDiff', async (req) => {
    const cwd = workerManager.cwd || process.cwd()
    try {
      if (req.scope === 'git') {
        const diff = execSync('git diff HEAD', { cwd, encoding: 'utf-8', timeout: 10000 })
        const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000 })
        return { diff: { raw: diff, status, scope: 'git' } }
      } else {
        const diff = execSync('git diff', { cwd, encoding: 'utf-8', timeout: 10000 })
        return { diff: { raw: diff, status: '', scope: req.scope } }
      }
    } catch (e: any) {
      return { diff: { raw: '', status: '', scope: req.scope, error: e.message } }
    }
  })

  // ── Trellis ──
  registerHandler('ipc:trellis.getState', async () => {
    const cwd = workerManager.cwd || process.cwd()
    return readTrellisState(cwd)
  })

  // ── Extensions ──
  registerHandler('ipc:extensions.list', async (_req) => {
    const cwd = workerManager.cwd || process.cwd()
    const probes = probeExtensions(cwd)
    return { extensions: probes }
  })

  registerHandler('ipc:extensions.setOverride', async (req) => {
    configStore.setExtensionOverride(req.extensionId, req.enabled)
    return { extensionId: req.extensionId, enabled: req.enabled }
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

  // ── Resources ──
  registerHandler('ipc:resources.list', async () => {
    const cwd = workerManager.cwd || process.cwd()
    return readResourceList(cwd)
  })
}
