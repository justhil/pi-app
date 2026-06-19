// Worker Manager - manages Pi Worker lifecycle from Main process via utilityProcess + MessageChannel

import { utilityProcess, MessageChannelMain, type BrowserWindow, type MessagePortMain } from 'electron'
import { join } from 'path'
import type { AppEvent } from '@shared/app-events'

interface InitResult {
  sessionId: string
  model?: string
  thinkingLevel?: string
}

export class WorkerManager {
  private worker: Electron.UtilityProcess | null = null
  private workerPort: MessagePortMain | null = null
  private mainWindow: BrowserWindow | null = null
  private currentCwd: string | null = null
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private requestCounter = 0

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(cwd: string): Promise<InitResult> {
    if (this.worker && this.currentCwd === cwd) {
      return { sessionId: 'already-running' }
    }

    await this.stop()

    this.currentCwd = cwd

    const { port1, port2 } = new MessageChannelMain()
    this.workerPort = port1

    // Forward events from worker to renderer
    port1.on('message', (event: Electron.MessageEvent) => {
      const data = event.data
      if (!data) return

      if (data.type === 'app-event' && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:events', data.event as AppEvent)
      }

      // Handle response to a request
      if (data.requestId && this.pendingRequests.has(data.requestId)) {
        const pending = this.pendingRequests.get(data.requestId)!
        this.pendingRequests.delete(data.requestId)
        if (data.type === 'error') {
          pending.reject(new Error(data.error))
        } else {
          pending.resolve(data)
        }
      }
    })
    port1.start()

    this.worker = utilityProcess.fork(join(__dirname, 'worker.mjs'), [], {
      stdio: 'pipe',
    })

    // Capture worker stderr/stdout for debugging - MUST handle errors to avoid EPIPE crash
    const safeWrite = (msg: string) => {
      try {
        process.stderr.write(msg + '\n')
      } catch {}
    }
    if (this.worker.stderr) {
      let stderrBuf = ''
      this.worker.stderr.on('error', () => {})
      this.worker.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
        const lines = stderrBuf.split('\n')
        stderrBuf = lines.pop() || ''
        for (const line of lines) {
          if (line.trim()) safeWrite(`[Worker:stderr] ${line}`)
        }
      })
    }
    if (this.worker.stdout) {
      this.worker.stdout.on('error', () => {})
      this.worker.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n')
        for (const line of lines) {
          if (line.trim()) safeWrite(`[Worker:stdout] ${line}`)
        }
      })
    }

    // Handle worker exit
    this.worker.on('exit', (code) => {
      console.warn(`[WorkerManager] Worker exited with code ${code}`)
      this.worker = null
      this.workerPort?.close()
      this.workerPort = null

      // Auto-restart if unexpected exit and we have a cwd
      if (code !== 0 && this.currentCwd) {
        console.log('[WorkerManager] Auto-restarting worker...')
        const cwd = this.currentCwd
        this.currentCwd = null
        setTimeout(() => {
          this.start(cwd).catch((e) => console.error('[WorkerManager] Restart failed:', e))
        }, 2000)
      }

      // Notify renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('ipc:worker-exit', { code, cwd: this.currentCwd })
      }
    })

    // Send init message with the port
    this.worker.postMessage({ type: 'init', cwd }, [port2])

    // Wait for init-done
    return new Promise<InitResult>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 30000)
      const onInit = (event: Electron.MessageEvent) => {
        const data = event.data
        if (data?.type === 'init-done') {
          clearTimeout(timeout)
          port1.off('message', onInit)
          resolve({
            sessionId: data.sessionId,
            model: data.model,
            thinkingLevel: data.thinkingLevel,
          })
        }
        if (data?.type === 'error') {
          clearTimeout(timeout)
          port1.off('message', onInit)
          reject(new Error(data.error))
        }
      }
      port1.on('message', onInit)
    })
  }

  async stop(): Promise<void> {
    // Mark as intentionally stopping to prevent auto-restart
    const wasRunning = this.worker !== null
    const prevCwd = this.currentCwd
    this.currentCwd = null

    if (this.workerPort) {
      try {
        this.workerPort.postMessage({ type: 'dispose' })
      } catch {}
      this.workerPort.close()
      this.workerPort = null
    }
    if (this.worker) {
      this.worker.kill()
      this.worker = null
    }
  }

  private async request(type: string, data?: any): Promise<any> {
    if (!this.workerPort) throw new Error('Worker not started')
    const requestId = `req-${++this.requestCounter}`
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject })
      this.workerPort!.postMessage({ type, requestId, ...data })
      // Timeout after 60s
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Worker request ${type} timed out`))
        }
      }, 60000)
    })
  }

  // Public API used by IPC handlers
  async sendPrompt(text: string): Promise<void> {
    await this.request('prompt', { text })
  }

  async sendPromptWithImages(text: string, images: { name: string; mimeType: string; data: string }[]): Promise<void> {
    await this.request('prompt', { text, options: { images: images.map(i => ({ type: 'image', source: { type: 'base64', mediaType: i.mimeType, data: i.data } })) } })
  }

  async abort(): Promise<void> {
    await this.request('abort')
  }

  async steer(text: string): Promise<void> {
    await this.request('steer', { text })
  }

  async followUp(text: string): Promise<void> {
    await this.request('followUp', { text })
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.request('setModel', { provider, modelId })
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.request('setThinkingLevel', { level })
  }

  async newSession(): Promise<{ sessionId: string }> {
    return await this.request('newSession')
  }

  async listSessions(cwd?: string): Promise<any[]> {
    const result = await this.request('listSessions', { cwd })
    return result.sessions || []
  }

  async getState(): Promise<any> {
    const result = await this.request('getState')
    return result.state
  }

  get isRunning(): boolean {
    return this.worker !== null
  }

  get cwd(): string | null {
    return this.currentCwd
  }
}

export const workerManager = new WorkerManager()
