// Worker Manager - manages Pi Worker lifecycle via utilityProcess built-in message channel

import { utilityProcess, type BrowserWindow } from 'electron'
import { join } from 'path'
import type { AppEvent } from '@shared/app-events'

interface InitResult {
  sessionId: string
  model?: string
  thinkingLevel?: string
}

export class WorkerManager {
  private worker: Electron.UtilityProcess | null = null
  private mainWindow: BrowserWindow | null = null
  private currentCwd: string | null = null
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }>()
  private requestCounter = 0
  private initResolver: ((r: InitResult) => void) | null = null
  private initRejecter: ((e: any) => void) | null = null
  private stopping = false
  /** When true, worker exit will not spawn another process (avoids task-manager process storms). */
  private autoRestartEnabled = false

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(cwd: string): Promise<InitResult> {
    if (this.worker && this.currentCwd === cwd) {
      return { sessionId: 'already-running' }
    }

    await this.stop()
    this.stopping = false
    this.autoRestartEnabled = true
    this.currentCwd = cwd

    this.worker = utilityProcess.fork(join(__dirname, 'worker.mjs'), [], {
      stdio: 'pipe',
    })

    // Capture worker stdout/stderr safely (avoid EPIPE)
    const safeWrite = (msg: string) => {
      try { process.stderr.write(msg + '\n') } catch {}
    }
    if (this.worker.stderr) {
      this.worker.stderr.on('error', () => {})
      this.worker.stderr.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) safeWrite(`[Worker:stderr] ${line}`)
        }
      })
    }
    if (this.worker.stdout) {
      this.worker.stdout.on('error', () => {})
      this.worker.stdout.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) safeWrite(`[Worker:stdout] ${line}`)
        }
      })
    }

    // Receive ALL messages from worker on the built-in channel
    // (worker uses process.parentPort.postMessage which arrives here)
    this.worker.on('message', (event: any) => {
      const data = event?.data ?? event
      if (!data) return

      // Forward app events to renderer
      if (data.type === 'app-event' && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:events', data.event as AppEvent)
      }

      if (data.type === 'extension-ui-request' && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:extension-ui-request', data.request)
      }

      // Resolve init promise
      if (data.type === 'init-done' && this.initResolver) {
        this.initResolver({ sessionId: data.sessionId, model: data.model, thinkingLevel: data.thinkingLevel })
        this.initResolver = null
        this.initRejecter = null
      }
      if (data.type === 'error' && data.phase === 'init' && this.initRejecter) {
        this.initRejecter(new Error(data.error))
        this.initResolver = null
        this.initRejecter = null
      }

      // Resolve pending requests
      if (data.requestId && this.pendingRequests.has(data.requestId)) {
        const pending = this.pendingRequests.get(data.requestId)!
        clearTimeout(pending.timer)
        this.pendingRequests.delete(data.requestId)
        if (data.type === 'error') pending.reject(new Error(data.error))
        else pending.resolve(data)
      }
    })

    // Handle worker exit
    this.worker.on('exit', (code) => {
      safeWrite(`[WorkerManager] Worker exited with code ${code}`)
      this.worker = null
      const cwd = this.currentCwd
      this.currentCwd = null

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:worker-exit', { code, cwd })
      }

      if (this.stopping || code === 0 || !cwd || !this.autoRestartEnabled) {
        return
      }

      safeWrite('[WorkerManager] Worker crashed; auto-restart is disabled — not spawning another worker')
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:worker-fatal', {
          code,
          cwd,
          message: 'Worker 已退出。请重新打开工作区；若界面空白请先结束任务管理器里多余的 pi Desktop 进程。',
        })
      }
    })

    // Send init (no port transfer — worker replies via process.parentPort)
    this.worker.postMessage({ type: 'init', cwd })

    return new Promise<InitResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.initResolver = null
        this.initRejecter = null
        reject(new Error('Worker init timeout (60s)'))
      }, 60000)
      this.initResolver = (r) => { clearTimeout(timer); resolve(r) }
      this.initRejecter = (e) => { clearTimeout(timer); reject(e) }
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.currentCwd = null
    if (this.worker) {
      try { this.worker.postMessage({ type: 'dispose' }) } catch {}
      // Give worker a moment to dispose gracefully
      await new Promise((r) => setTimeout(r, 100))
      try { this.worker.kill() } catch {}
      this.worker = null
    }
    this.pendingRequests.clear()
  }

  private request(type: string, data?: any): Promise<any> {
    if (!this.worker) return Promise.reject(new Error('Worker not started'))
    const requestId = `req-${++this.requestCounter}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Worker request ${type} timed out`))
        }
      }, 120000)
      this.pendingRequests.set(requestId, { resolve, reject, timer })
      this.worker!.postMessage({ type, requestId, ...data })
    })
  }

  async sendPrompt(text: string): Promise<void> { await this.request('prompt', { text }) }
  async sendPromptWithImages(text: string, images: any[]): Promise<void> {
    await this.request('prompt', { text, options: { images } })
  }
  async abort(): Promise<void> { await this.request('abort') }
  async steer(text: string): Promise<void> { await this.request('steer', { text }) }
  async followUp(text: string): Promise<void> { await this.request('followUp', { text }) }
  async setModel(provider: string, modelId: string): Promise<void> { await this.request('setModel', { provider, modelId }) }
  async setThinkingLevel(level: string): Promise<void> { await this.request('setThinkingLevel', { level }) }
  async newSession(): Promise<{ sessionId: string }> { return await this.request('newSession') }
  async listSessions(cwd?: string): Promise<any[]> {
    const r = await this.request('listSessions', { cwd })
    return r.sessions || []
  }
  async getState(): Promise<any> { return (await this.request('getState')).state }
  async getCommands(): Promise<{ commands: any[]; hasSession: boolean }> {
    const r = await this.request('getCommands')
    return { commands: r.commands || [], hasSession: !!r.hasSession }
  }
  async getSessionContextPreview(): Promise<any> {
    const r = await this.request('getSessionContextPreview')
    return r.preview || null
  }
  async getSkillsList(): Promise<any[]> {
    const r = await this.request('getSkillsList')
    return r.skills || []
  }
  async getPromptTemplatesList(): Promise<any[]> {
    const r = await this.request('getPromptTemplatesList')
    return r.prompts || []
  }
  async getContextPrompts(): Promise<any> {
    return this.request('getContextPrompts')
  }
  async reloadResources(): Promise<void> {
    await this.request('reloadResources')
  }
  async getCommandCompletions(commandName: string, argumentPrefix: string): Promise<any[]> {
    const r = await this.request('getCommandCompletions', { commandName, argumentPrefix })
    return r.items || []
  }
  async getModels(): Promise<any[]> {
    const r = await this.request('getModels')
    return r.models || []
  }
  async getPiSettings(): Promise<any> { return (await this.request('getPiSettings')).settings }
  async setPiSettings(patch: any): Promise<void> { await this.request('setPiSettings', { patch }) }
  async getMessages(
    sessionFile: string,
    offset?: number,
    limit?: number,
  ): Promise<{ items: any[]; totalCount: number; sessionMeta?: { model?: string; thinkingLevel?: string } }> {
    const r = await this.request('getMessages', { sessionFile, offset, limit })
    return {
      items: r.items || [],
      totalCount: typeof r.totalCount === 'number' ? r.totalCount : (r.items || []).length,
      sessionMeta: r.sessionMeta,
    }
  }
  async loadSession(sessionFile: string): Promise<{ sessionId: string; model?: string }> {
    return await this.request('loadSession', { sessionFile })
  }
  async renameSessionFile(sessionFile: string, title: string): Promise<{ ok: boolean; title?: string; error?: string }> {
    return await this.request('sessionRenameFile', { sessionFile, title })
  }
  async deleteSessionFile(sessionFile: string): Promise<{ ok: boolean; error?: string }> {
    return await this.request('sessionDeleteFile', { sessionFile })
  }
  async getSessionTree(sessionFile?: string): Promise<{ nodes: any[]; leafId: string | null; error?: string }> {
    const r = await this.request('getSessionTree', sessionFile ? { sessionFile } : {})
    return { nodes: r.nodes || [], leafId: r.leafId ?? null, error: r.error }
  }
  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; label?: string },
  ): Promise<{
    cancelled: boolean
    editorText?: string
    leafId?: string | null
    sessionMeta?: { model?: string; thinkingLevel?: string }
  }> {
    const r = await this.request('navigateTree', { targetId, ...options })
    return {
      cancelled: !!r.cancelled,
      editorText: r.editorText,
      leafId: r.leafId ?? null,
      sessionMeta: r.sessionMeta,
    }
  }
  async runExtensionCommand(text: string): Promise<void> {
    await this.request('runExtensionCommand', { text })
  }

  respondExtensionUI(response: { id: string; value?: string; confirmed?: boolean; cancelled?: boolean; result?: unknown }): void {
    if (!this.worker) return
    this.worker.postMessage({ type: 'extension-ui-response', response })
  }

  get isRunning(): boolean { return this.worker !== null }
  get cwd(): string | null { return this.currentCwd }
}

export const workerManager = new WorkerManager()
