// Worker Manager - manages Pi Worker lifecycle from Main process

import { utilityProcess, MessageChannelMain, type BrowserWindow } from 'electron'
import { join } from 'path'
import type { AppEvent } from '@shared/app-events'

export class WorkerManager {
  private worker: Electron.UtilityProcess | null = null
  private workerPort: Electron.MessagePortMain | null = null
  private mainWindow: BrowserWindow | null = null
  private currentCwd: string | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(cwd: string): Promise<void> {
    if (this.worker && this.currentCwd === cwd) {
      return // Already running for this cwd
    }

    await this.stop()

    this.currentCwd = cwd

    const { port1, port2 } = new MessageChannelMain()
    this.workerPort = port1

    // Forward events from worker to renderer
    port1.on('message', (event: any) => {
      if (event.data?.type === 'app-event' && this.mainWindow) {
        this.mainWindow.webContents.send('ipc:events', event.data.event as AppEvent)
      }
    })
    port1.start()

    this.worker = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
      stdio: 'pipe',
    })

    // Send init message with the port
    this.worker.postMessage({ type: 'init', cwd }, [port2])

    return new Promise((resolve) => {
      const onMessage = (event: any) => {
        if (event.data?.type === 'init-done') {
          this.workerPort?.off('message', onMessage)
          resolve()
        }
      }
      port1.on('message', onMessage)
    })
  }

  async stop(): Promise<void> {
    if (this.workerPort) {
      this.workerPort.postMessage({ type: 'dispose' })
      this.workerPort.close()
      this.workerPort = null
    }
    if (this.worker) {
      this.worker.kill()
      this.worker = null
    }
    this.currentCwd = null
  }

  sendPrompt(text: string): void {
    this.workerPort?.postMessage({ type: 'prompt', text })
  }

  sendPromptWithImages(text: string, images: { name: string; mimeType: string; data: string }[]): void {
    this.workerPort?.postMessage({ type: 'prompt', text, options: { images: images.map(i => ({ type: 'image' as const, source: { type: 'base64' as const, mediaType: i.mimeType, data: i.data } })) } })
  }

  abort(): void {
    this.workerPort?.postMessage({ type: 'abort' })
  }

  steer(text: string): void {
    this.workerPort?.postMessage({ type: 'steer', text })
  }

  followUp(text: string): void {
    this.workerPort?.postMessage({ type: 'followUp', text })
  }

  setModel(provider: string, modelId: string): void {
    this.workerPort?.postMessage({ type: 'setModel', provider, modelId })
  }

  setThinkingLevel(level: string): void {
    this.workerPort?.postMessage({ type: 'setThinkingLevel', level })
  }

  newSession(): void {
    this.workerPort?.postMessage({ type: 'newSession' })
  }

  get isRunning(): boolean {
    return this.worker !== null
  }

  get cwd(): string | null {
    return this.currentCwd
  }
}

export const workerManager = new WorkerManager()
