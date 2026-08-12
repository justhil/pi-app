import type { ChildProcess } from 'child_process'
import { decodeWorkerFrameLine } from '@shared/worker-frame'
import { windowsPathToWsl } from '@shared/wsl-path'
import { getAgentRuntimeConfig } from './runtime-config'
import { resolveWslActiveSdk } from './sdk-resolve'
import { spawnPreviewInWsl, syncPreviewBundleToWsl } from './preview-host'

export type WslPreviewRequest = {
  type:
    | 'session.list'
    | 'session.getMessages'
    | 'session.tree'
    | 'session.invalidateList'
    | 'pi.settings.set'
  payload: Record<string, unknown>
  userDataDir: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WslSessionPreviewRunner {
  private process: ChildProcess | null = null
  private processKey: string | null = null
  private pending = new Map<string, Pending>()
  private sequence = 0
  private lifecycleGeneration = 0
  private stoppedError: Error | null = null
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

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private assertLifecycle(generation: number): void {
    if (generation !== this.lifecycleGeneration) {
      throw this.stoppedError || new Error('WSL preview stopped')
    }
  }

  private async ensureProcess(cwd: string, generation: number): Promise<{ process: ChildProcess; sdkPath: string }> {
    const runtime = getAgentRuntimeConfig()
    if (runtime.mode !== 'wsl' || !runtime.distro) throw new Error('WSL preview runtime is not active')
    const stopping = this.stopping
    const sdk = await Promise.race([
      resolveWslActiveSdk(runtime.distro),
      stopping,
    ])
    this.assertLifecycle(generation)
    if (!sdk) throw new Error(`[WSL] 发行版 ${runtime.distro} 内未找到 pi-coding-agent`)
    const processKey = `${runtime.distro}\u0000${cwd}`
    if (this.process && this.processKey === processKey) return { process: this.process, sdkPath: sdk.entryPath }
    if (this.process) {
      const error = new Error('WSL preview cwd changed')
      this.rejectPending(error)
      this.process.kill()
      this.process = null
      this.processKey = null
    }

    const previewWslPath = syncPreviewBundleToWsl(runtime.distro)
    this.assertLifecycle(generation)
    if (!previewWslPath) throw new Error('[WSL] 无法将 preview utility 同步到发行版')
    const proc = spawnPreviewInWsl({
      distro: runtime.distro,
      wslCwd: cwd,
      previewWslPath,
    })
    if (generation !== this.lifecycleGeneration) {
      proc.kill()
      this.assertLifecycle(generation)
    }
    let buffer = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const response = decodeWorkerFrameLine(line)
        if (response) this.onMessage(response)
        else if (line.trim()) process.stderr.write(`[Preview:WSL:stdout] ${line}\n`)
        newline = buffer.indexOf('\n')
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[Preview:WSL:stderr] ${chunk}`))
    proc.on('error', (error) => this.onExit(proc, error))
    proc.on('exit', (code) => this.onExit(proc, new Error(`WSL preview exited with code ${code}`)))
    this.process = proc
    this.processKey = processKey
    return { process: proc, sdkPath: sdk.entryPath }
  }

  private onMessage(response: Record<string, unknown>): void {
    const requestId = typeof response.requestId === 'string' ? response.requestId : ''
    const pending = this.pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    if (response.type === 'error') pending.reject(new Error(String(response.error || 'WSL preview failed')))
    else pending.resolve(response.result)
  }

  private onExit(proc: ChildProcess, error: Error): void {
    if (this.process !== proc) return
    this.process = null
    this.processKey = null
    this.rejectPending(error)
  }

  async request<T>(request: WslPreviewRequest): Promise<T> {
    this.stoppedError = null
    const generation = this.lifecycleGeneration
    const runtime = getAgentRuntimeConfig()
    if (runtime.mode !== 'wsl' || !runtime.distro) throw new Error('WSL preview runtime is not active')
    const cwd = windowsPathToWsl(
      runtime.distro,
      String(request.payload.cwd || request.payload.workspaceId || ''),
    ) || '/'
    const payload: Record<string, unknown> = { ...request.payload, cwd }
    if (typeof payload.workspaceId === 'string') {
      payload.workspaceId = windowsPathToWsl(runtime.distro, payload.workspaceId)
    }
    if (typeof payload.sessionFile === 'string') {
      payload.sessionFile = windowsPathToWsl(runtime.distro, payload.sessionFile)
    }
    const { process: proc, sdkPath } = await this.ensureProcess(cwd, generation)
    this.assertLifecycle(generation)
    const stdin = proc.stdin
    if (!stdin?.writable) throw new Error('WSL preview stdin is not writable')
    const requestId = `wsl-preview-${++this.sequence}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        if (this.process === proc) {
          this.process = null
          this.processKey = null
          proc.kill()
        }
        reject(new Error(`WSL preview request ${request.type} timed out`))
      }, 120_000)
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      try {
        stdin.write(JSON.stringify({
          requestId,
          type: request.type,
          ...payload,
          userDataDir: request.userDataDir,
          sdkPath,
        }) + '\n')
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  stop(): void {
    const error = new Error('WSL preview stopped')
    this.stoppedError = error
    this.lifecycleGeneration++
    this.rejectStop(error)
    this.stopping = this.createStoppingPromise()
    const proc = this.process
    this.process = null
    this.processKey = null
    this.rejectPending(error)
    proc?.kill()
  }
}
