import { app, utilityProcess, type UtilityProcess } from 'electron'
import { resolveUtilityEntry } from './utility-entry-path'
import { resolveActiveSdk } from './sdk-loader'
import { isWslRuntimeActive } from './wsl/runtime-config'
import { emitOperationEvent } from './operation-events'
import type { FlatTreeNode } from './session-tree-from-file'
import type { SessionOnDiskRow } from './ipc/sdk-session'
import type { DiskSessionMessages } from './session-messages-from-disk'

type PreviewResponse = { requestId: string; ok: boolean; result?: unknown; error?: string }
type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SessionPreviewProcess {
  private process: UtilityProcess | null = null
  private wslRunner: import('./wsl/session-preview-runner').WslSessionPreviewRunner | null = null
  private pending = new Map<string, Pending>()
  private sequence = 0
  private lifecycleGeneration = 0
  private rejectStop!: (error: Error) => void
  private stopping: Promise<never>

  constructor() {
    this.stopping = this.createStoppingPromise()
  }

  private createStoppingPromise(): Promise<never> {
    const stopping = new Promise<never>((_resolve, reject) => {
      this.rejectStop = reject
    })
    void stopping.catch(() => {})
    return stopping
  }

  private assertLifecycle(generation: number): void {
    if (generation !== this.lifecycleGeneration) throw new Error('Preview process stopped')
  }

  private async awaitLifecycle<T>(value: T | Promise<T>, generation: number): Promise<T> {
    const result = await Promise.race([
      Promise.resolve(value),
      this.stopping,
    ])
    this.assertLifecycle(generation)
    return result
  }

  private ensureProcess(generation: number): UtilityProcess {
    this.assertLifecycle(generation)
    if (this.process) return this.process
    const started = Date.now()
    const proc = utilityProcess.fork(resolveUtilityEntry('preview.mjs'), [], { stdio: 'pipe' })
    if (generation !== this.lifecycleGeneration) {
      proc.kill()
      this.assertLifecycle(generation)
    }
    proc.on('message', (raw) => this.onMessage(raw as PreviewResponse))
    proc.on('spawn', () => {
      emitOperationEvent({ operation: 'session-preview.start', status: 'ok', durationMs: Date.now() - started })
    })
    proc.stdout?.on('data', (chunk: Buffer) => this.logProcessOutput('stdout', chunk))
    proc.stderr?.on('data', (chunk: Buffer) => this.logProcessOutput('stderr', chunk))
    proc.on('exit', (code) => {
      if (this.process !== proc) return
      this.process = null
      emitOperationEvent({ operation: 'session-preview.exit', status: code === 0 ? 'ok' : 'error', detail: String(code) })
      this.rejectAll(new Error(`Preview process exited with code ${code}`))
    })
    this.process = proc
    return proc
  }

  private logProcessOutput(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) process.stderr.write(`[Preview:${stream}] ${line}\n`)
    }
  }

  private onMessage(response: PreviewResponse): void {
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error || 'Preview request failed'))
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private async request<T>(
    type:
      | 'session.list'
      | 'session.getMessages'
      | 'session.tree'
      | 'session.invalidateList'
      | 'pi.settings.set'
      | 'system.prompt',
    payload: Record<string, unknown>,
  ): Promise<T> {
    const generation = this.lifecycleGeneration
    const userDataDir = app.getPath('userData')
    if (isWslRuntimeActive()) {
      const { WslSessionPreviewRunner } = await this.awaitLifecycle(
        import('./wsl/session-preview-runner'),
        generation,
      )
      if (!this.wslRunner) this.wslRunner = new WslSessionPreviewRunner()
      this.assertLifecycle(generation)
      return this.wslRunner.request<T>({ type, payload, userDataDir })
    }

    const requestId = `preview-${++this.sequence}`
    let proc: UtilityProcess
    try {
      proc = this.ensureProcess(generation)
      this.assertLifecycle(generation)
    } catch (error) {
      return Promise.reject(error)
    }
    const activeSdk = await this.awaitLifecycle(resolveActiveSdk(userDataDir), generation)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        if (this.process === proc) {
          this.process = null
          proc.kill()
        }
        reject(new Error(`Preview request ${type} timed out`))
      }, 120_000)
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      const activeSdkPath = activeSdk.kind === 'builtin' ? null : activeSdk.entryPath
      try {
        proc.postMessage({
          requestId,
          type,
          payload,
          userDataDir,
          activeSdkPath,
        })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  listSessions(workspaceId: string): Promise<SessionOnDiskRow[]> {
    return this.request('session.list', { workspaceId, cwd: workspaceId })
  }

  async invalidateListSessions(workspaceId?: string): Promise<void> {
    const cwd = workspaceId || process.cwd()
    await this.request('session.invalidateList', { workspaceId, cwd })
  }

  getMessages(payload: {
    sessionFile: string
    cwd: string
    offset: number
    limit?: number
    leafId?: string | null
    showNonMessageEntries?: boolean
  }): Promise<DiskSessionMessages> {
    return this.request('session.getMessages', { ...payload, cwd: payload.cwd })
  }

  getTree(payload: {
    sessionFile: string
    cwd: string
    leafId?: string | null
  }): Promise<{ nodes: FlatTreeNode[]; leafId: string | null }> {
    return this.request('session.tree', payload)
  }

  getSystemPrompt(payload: {
    cwd: string
    globalSettings?: Record<string, unknown>
    projectSettings?: Record<string, unknown>
  }): Promise<string> {
    return this.request('system.prompt', payload)
  }

  setPiSettings(patch: Record<string, unknown>, cwd: string): Promise<void> {
    return this.request('pi.settings.set', { patch, cwd })
  }

  inspectLifecycleForTest(): { process: boolean; pending: number } {
    return { process: this.process !== null, pending: this.pending.size }
  }

  stop(): void {
    const error = new Error('Preview process stopped')
    this.lifecycleGeneration++
    this.rejectStop(error)
    this.stopping = this.createStoppingPromise()
    const proc = this.process
    this.process = null
    this.rejectAll(error)
    this.wslRunner?.stop()
    this.wslRunner = null
    proc?.kill()
  }
}

export const sessionPreviewProcess = new SessionPreviewProcess()
