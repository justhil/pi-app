// Worker Manager - manages Pi Worker lifecycle via utilityProcess built-in message channel

import { utilityProcess, app, type BrowserWindow } from 'electron'
import { join } from 'path'
import type { AppEvent } from '@shared/app-events'
import { resolveActiveSdk } from './sdk-loader'

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
  private initPromise: Promise<InitResult> | null = null
  private stopping = false
  /** When true, worker exit will not spawn another process (avoids task-manager process storms). */
  private autoRestartEnabled = false
  /** Worker init 时全局 pi 加载失败已回退内置（UI 提示用）。 */
  private sdkFallback = false
  /** 串行化 start/stop，避免 SDK 切换时并行 fork 多个 worker。 */
  private lifecycleChain: Promise<unknown> = Promise.resolve()
  /** 与 Worker agent_start/agent_end 同步，Main 侧再拦一层 extension-ui（防旧进程/竞态） */
  private agentTurnActive = false

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(cwd: string): Promise<InitResult> {
    const run = this.lifecycleChain.then(() => this.startUnlocked(cwd))
    this.lifecycleChain = run.then(() => undefined, () => undefined)
    return run
  }

  private async startUnlocked(cwd: string): Promise<InitResult> {
    if (this.worker && this.currentCwd === cwd && this.initPromise) {
      return this.initPromise
    }

    const prev = this.currentCwd
    if (prev !== cwd) {
      try {
        const { traceAudio } = await import('./audio-trace')
        traceAudio('main.workerRestart', { from: prev, to: cwd })
      } catch {
        /* ignore */
      }
    }
    this.agentTurnActive = false

    await this.stopUnlocked()
    this.stopping = false
    this.autoRestartEnabled = true
    this.currentCwd = cwd

    const forked = utilityProcess.fork(join(__dirname, 'worker.mjs'), [], {
      stdio: 'pipe',
    })
    this.worker = forked

    const safeWrite = (msg: string) => {
      try { process.stderr.write(msg + '\n') } catch {}
    }
    if (forked.stderr) {
      forked.stderr.on('error', () => {})
      forked.stderr.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) safeWrite(`[Worker:stderr] ${line}`)
        }
      })
    }
    if (forked.stdout) {
      forked.stdout.on('error', () => {})
      forked.stdout.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) safeWrite(`[Worker:stdout] ${line}`)
        }
      })
    }

    forked.on('message', (event: any) => {
      if (this.worker !== forked) return
      const data = event?.data ?? event
      if (!data) return

      if (data.type === 'app-event' && this.mainWindow && !this.mainWindow.isDestroyed()) {
        const ev = data.event as AppEvent
        if (ev?.type === 'run') {
          if (ev.phase === 'running' || ev.phase === 'started') this.agentTurnActive = true
          else if (ev.phase === 'idle' || ev.phase === 'failed' || ev.phase === 'cancelled') {
            this.agentTurnActive = false
          }
        }
        this.mainWindow.webContents.send('ipc:events', ev)
      }

      if (
        (data.type === 'extension-ui-dismiss' || data.type === 'extension-ui-dismiss-all') &&
        this.mainWindow &&
        !this.mainWindow.isDestroyed()
      ) {
        this.mainWindow.webContents.send('ipc:extension-ui-dismiss', {
          type: data.type,
          id: data.id,
          reason: data.reason,
        })
      }

      if (data.type === 'extension-ui-request' && this.mainWindow && !this.mainWindow.isDestroyed()) {
        const req = data.request as { method?: string; notifyType?: string; message?: string }
        const method = req?.method || ''
        // Only gate notify by agentTurnActive; dialog requests (confirm/select/input/editor/custom)
        // must always pass so navigateTree and other non-turn UI calls can complete.
        const allow =
          method !== 'notify' ||
          this.agentTurnActive ||
          req.notifyType === 'error'
        if (!allow) {
          void import('./audio-trace').then(({ traceAudio }) => {
            traceAudio('main.dropExtensionUi', {
              method,
              notifyType: req.notifyType,
              agentTurnActive: this.agentTurnActive,
              msg: String(req.message || '').slice(0, 80),
            })
          })
          return
        }
        void import('./audio-trace').then(({ traceAudio }) => {
          traceAudio('main.forwardExtensionUi', { method, notifyType: req.notifyType })
        })
        this.mainWindow.webContents.send('ipc:extension-ui-request', data.request)
      }

      if (data.type === 'init-done' && this.initResolver) {
        this.sdkFallback = !!data.sdkFallback
        if (this.sdkFallback) safeWrite('[WorkerManager] Target SDK import failed, worker fell back to builtin')
        this.initResolver({ sessionId: data.sessionId, model: data.model, thinkingLevel: data.thinkingLevel })
        this.initResolver = null
        this.initRejecter = null
      }
      if (data.type === 'error' && this.initRejecter) {
        this.initRejecter(new Error(data.error))
        this.initResolver = null
        this.initRejecter = null
        this.initPromise = null
      }

      if (data.requestId && this.pendingRequests.has(data.requestId)) {
        const pending = this.pendingRequests.get(data.requestId)!
        clearTimeout(pending.timer)
        this.pendingRequests.delete(data.requestId)
        if (data.type === 'error') pending.reject(new Error(data.error))
        else pending.resolve(data)
      }
    })

    forked.on('exit', (code) => {
      if (this.worker !== forked) {
        safeWrite(`[WorkerManager] Ignoring stale worker exit (code ${code})`)
        return
      }
      safeWrite(`[WorkerManager] Worker exited with code ${code}`)
      this.worker = null
      const cwdOnExit = this.currentCwd
      this.currentCwd = null
      this.initPromise = null
      if (this.initRejecter) {
        this.initRejecter(new Error(`Worker exited during init with code ${code}`))
        this.initResolver = null
        this.initRejecter = null
        this.initPromise = null
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:worker-exit', { code, cwd: cwdOnExit })
      }

      if (this.stopping || code === 0 || !cwdOnExit || !this.autoRestartEnabled) {
        return
      }

      safeWrite('[WorkerManager] Worker crashed; auto-restart is disabled — not spawning another worker')
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:worker-fatal', {
          code,
          cwd: cwdOnExit,
          message: 'Worker 已退出。请重新打开工作区；若界面空白请先结束任务管理器里多余的 pi Desktop 进程。',
        })
      }
    })

    this.initPromise = new Promise<InitResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.worker !== forked) return
        this.initResolver = null
        this.initRejecter = null
        this.initPromise = null
        reject(new Error('Worker init timeout (60s)'))
      }, 60000)
      this.initResolver = (r) => { clearTimeout(timer); resolve(r) }
      this.initRejecter = (e) => { clearTimeout(timer); reject(e) }
    })

    const activeSdk = resolveActiveSdk(app.getPath('userData'))
    const sdkPath = activeSdk.kind === 'builtin' ? null : activeSdk.entryPath

    forked.postMessage({ type: 'init', cwd, sdkPath })

    return this.initPromise
  }

  async stop(): Promise<void> {
    const run = this.lifecycleChain.then(() => this.stopUnlocked())
    this.lifecycleChain = run.then(() => undefined, () => undefined)
    return run
  }

  private async stopUnlocked(): Promise<void> {
    this.stopping = true
    const toStop = this.worker
    if (this.initRejecter) {
      this.initRejecter(new Error('Worker stopped'))
      this.initResolver = null
      this.initRejecter = null
    }
    this.initPromise = null
    if (toStop) {
      try { toStop.postMessage({ type: 'dispose' }) } catch {}
      await new Promise((r) => setTimeout(r, 150))
      try { toStop.kill() } catch {}
      if (this.worker === toStop) {
        this.worker = null
      }
    }
    this.pendingRequests.clear()
    this.sdkFallback = false
  }

  private request(type: string, data?: any): Promise<any> {
    if (!this.worker) return Promise.reject(new Error('Worker not started'))
    const requestId = `req-${++this.requestCounter}`
    const proc = this.worker
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Worker request ${type} timed out`))
        }
      }, 120000)
      this.pendingRequests.set(requestId, { resolve, reject, timer })
      try {
        proc.postMessage({ type, requestId, ...data })
      } catch (e) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        reject(e)
      }
    })
  }

  async sendPrompt(text: string): Promise<void> { await this.request('prompt', { text }) }
  async sendPromptWithImages(text: string, images: any[]): Promise<void> {
    await this.request('prompt', { text, options: { images } })
  }
  async abort(): Promise<void> { await this.request('abort') }
  async steer(text: string): Promise<void> { await this.request('steer', { text }) }
  async followUp(text: string): Promise<void> { await this.request('followUp', { text }) }
  async clearPromptQueue(): Promise<{ steering: string[]; followUp: string[] }> {
    const r = await this.request('clearQueue')
    return { steering: r.steering || [], followUp: r.followUp || [] }
  }
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
  get lastSdkFallback(): boolean { return this.sdkFallback }
}

export const workerManager = new WorkerManager()