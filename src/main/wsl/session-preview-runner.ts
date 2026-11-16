import type { ChildProcess } from 'child_process'
import { StringDecoder } from 'node:string_decoder'
import { decodeWorkerFrameLine } from '@shared/worker-frame'
import { windowsPathToWsl, wslPathToWindows } from '@shared/wsl-path'
import { mainLabel } from '@shared/main-labels'
import { getMainUiLanguage } from '@shared/main-language'
import { getAgentRuntimeConfig } from './runtime-config'
import { resolveWslActiveSdk } from './sdk-resolve'
import { spawnPreviewInWsl, syncPreviewBundleToWsl } from './preview-host'

export type WslPreviewRequest = {
  type:
    | 'session.list'
    | 'session.getMessages'
    | 'session.tree'
    | 'session.invalidateList'
    | 'pi.settings.get'
    | 'pi.settings.set'
    | 'extensions.probe'
    | 'model.list'
    | 'context.preview'
    | 'warm'
    | 'system.prompt'
    | 'usage.summary'
    | 'usage.logs'
    | 'usage.requestDetail'
  payload: Record<string, unknown>
  userDataDir: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  /** Process the request was written to; its termination ends the request. */
  owner: ChildProcess
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

  private rejectOwnedBy(proc: ChildProcess, error: Error): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.owner !== proc) continue
      clearTimeout(pending.timer)
      this.pending.delete(requestId)
      pending.reject(error)
    }
  }

  /** Detach, fail every request owned by `proc`, then kill it; a newer process is untouched. */
  private terminateProcess(proc: ChildProcess, error: Error): void {
    if (this.process === proc) {
      this.process = null
      this.processKey = null
    }
    this.rejectOwnedBy(proc, error)
    proc.kill()
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
    if (!sdk) throw new Error(mainLabel(getMainUiLanguage(), 'wsl.sdkMissingPreview', { distro: runtime.distro }))
    // One process per distro: every request carries its own cwd/paths, so there is no reason to
    // respawn (wsl.exe + cold SDK import, seconds) when requests for different dirs interleave.
    const processKey = runtime.distro
    if (this.process && this.processKey === processKey) return { process: this.process, sdkPath: sdk.entryPath }
    if (this.process) this.terminateProcess(this.process, new Error('WSL preview distro changed'))

    const previewWslPath = await Promise.race([syncPreviewBundleToWsl(runtime.distro), stopping])
    this.assertLifecycle(generation)
    // Another request may have completed the same asynchronous bundle sync first.
    if (this.process && this.processKey === processKey) return { process: this.process, sdkPath: sdk.entryPath }
    if (!previewWslPath) throw new Error(mainLabel(getMainUiLanguage(), 'wsl.previewSyncFailed'))
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
    const stdoutDecoder = new StringDecoder('utf8')
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += stdoutDecoder.write(chunk)
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
    if (this.process === proc) {
      this.process = null
      this.processKey = null
    }
    this.rejectOwnedBy(proc, error)
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
    if (typeof payload.agentDir === 'string') {
      payload.agentDir = windowsPathToWsl(runtime.distro, payload.agentDir)
    }
    if (request.type === 'usage.logs' && typeof payload.project === 'string' && payload.project !== '(unknown)') {
      payload.project = windowsPathToWsl(runtime.distro, payload.project)
    }
    const { process: proc, sdkPath } = await this.ensureProcess(cwd, generation)
    this.assertLifecycle(generation)
    const stdin = proc.stdin
    if (!stdin?.writable) throw new Error('WSL preview stdin is not writable')
    const requestId = `wsl-preview-${++this.sequence}`
    const result = await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`WSL preview request ${request.type} timed out`))
        this.terminateProcess(proc, new Error(`WSL preview terminated after ${request.type} timed out`))
      }, 120_000)
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        owner: proc,
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
    // Match worker events: paths crossing into Main use the Windows view of WSL.
    if (request.type === 'session.list' && Array.isArray(result)) {
      return result.map((row) => ({
        ...row,
        path: wslPathToWindows(runtime.distro, row.path),
        ...(row.cwd ? { cwd: wslPathToWindows(runtime.distro, row.cwd) } : {}),
        ...(row.parentSessionPath ? { parentSessionPath: wslPathToWindows(runtime.distro, row.parentSessionPath) } : {}),
      })) as T
    }
    if (request.type === 'usage.summary' && result && typeof result === 'object') {
      const s = result as {
        byProject?: Array<{ project: string }>
        topSessions?: Array<{ sessionFile: string; project: string }>
      }
      return {
        ...s,
        ...(Array.isArray(s.byProject)
          ? {
              byProject: s.byProject.map((p) => ({
                ...p,
                project: p.project === '(unknown)' ? p.project : wslPathToWindows(runtime.distro, p.project),
              })),
            }
          : {}),
        ...(Array.isArray(s.topSessions)
          ? {
              topSessions: s.topSessions.map((row) => ({
                ...row,
                sessionFile: wslPathToWindows(runtime.distro, row.sessionFile),
                project: row.project === '(unknown)' ? row.project : wslPathToWindows(runtime.distro, row.project),
              })),
            }
          : {}),
      } as T
    }
    if (request.type === 'usage.logs' && result && typeof result === 'object') {
      const p = result as {
        rows?: Array<{ sessionFile: string; project: string }>
        facets?: { models: string[]; projects: string[]; apis: string[] }
      }
      return {
        ...p,
        ...(Array.isArray(p.rows)
          ? {
              rows: p.rows.map((r) => ({
                ...r,
                sessionFile: wslPathToWindows(runtime.distro, r.sessionFile),
                project: r.project === '(unknown)' ? r.project : wslPathToWindows(runtime.distro, r.project),
              })),
            }
          : {}),
        ...(p.facets
          ? {
              facets: {
                ...p.facets,
                projects: p.facets.projects.map((proj) =>
                  proj === '(unknown)' ? proj : wslPathToWindows(runtime.distro, proj),
                ),
              },
            }
          : {}),
      } as T
    }
    if (request.type === 'usage.requestDetail' && result && typeof result === 'object') {
      const d = result as { sessionFile?: string; project?: string }
      return {
        ...d,
        ...(typeof d.sessionFile === 'string' ? { sessionFile: wslPathToWindows(runtime.distro, d.sessionFile) } : {}),
        ...(typeof d.project === 'string' && d.project !== '(unknown)'
          ? { project: wslPathToWindows(runtime.distro, d.project) }
          : {}),
      } as T
    }
    return result
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
