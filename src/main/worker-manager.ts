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

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(cwd: string): Promise<InitResult> {
    if (this.worker && this.currentCwd === cwd) {
      return { sessionId: 'already-running' }
    }

    await this.stop()
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

      // Auto-restart on unexpected crash (not on graceful dispose)
      if (code !== 0 && cwd) {
        safeWrite('[WorkerManager] Auto-restarting worker...')
        setTimeout(() => {
          this.start(cwd).catch((e) => safeWrite(`[WorkerManager] Restart failed: ${e}`))
        }, 2000)
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:worker-exit', { code, cwd })
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
  async getMessages(sessionFile: string): Promise<any[]> {
    const r = await this.request('getMessages', { sessionFile })
    return r.items || []
  }
  async loadSession(sessionFile: string): Promise<{ sessionId: string; model?: string }> {
    return await this.request('loadSession', { sessionFile })
  }

  get isRunning(): boolean { return this.worker !== null }
  get cwd(): string | null { return this.currentCwd }
}

export const workerManager = new WorkerManager()
