/**
 * Transport abstraction over a worker process. Two implementations:
 *  - `utilityProcess` (host mode): Electron utilityProcess + message port
 *  - `wsl` (WSL mode): `wsl.exe -d <distro> --cd ... -- node worker.mjs` with
 *    prefixed JSONL framing over stdout / stdin
 */

import type { ChildProcess } from 'child_process'
import type { UtilityProcess } from 'electron'
import { decodeWorkerFrameLine } from '@shared/worker-frame'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'
import { spawnWorkerInWsl } from './wsl/worker-host'

export interface WorkerTransport {
  readonly kind: 'utilityProcess' | 'wsl'
  readonly pid?: number
  postMessage(message: Record<string, unknown>): void
  onMessage(callback: (message: WorkerResponsePayload) => void): void
  onExit(callback: (code: number) => void): void
  onStdout(callback: (chunk: string) => void): void
  onStderr(callback: (chunk: string) => void): void
  kill(): void
}

export function createUtilityProcessTransport(proc: UtilityProcess): WorkerTransport {
  return {
    kind: 'utilityProcess',
    get pid() {
      return proc.pid
    },
    postMessage: (message) => proc.postMessage(message),
    onMessage: (cb) => {
      proc.on('message', (event: { data?: WorkerResponsePayload } | WorkerResponsePayload) => {
        const data =
          typeof event === 'object' && event !== null && 'data' in event
            ? (event as { data?: WorkerResponsePayload }).data
            : (event as WorkerResponsePayload)
        if (data) cb(data)
      })
    },
    onExit: (cb) => {
      proc.on('exit', (code) => cb(code))
    },
    onStdout: (cb) => {
      const s = proc.stdout
      if (s) {
        s.on('error', () => {})
        s.on('data', (chunk: Buffer) => cb(chunk.toString()))
      }
    },
    onStderr: (cb) => {
      const s = proc.stderr
      if (s) {
        s.on('error', () => {})
        s.on('data', (chunk: Buffer) => cb(chunk.toString()))
      }
    },
    kill: () => {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
    },
  }
}

export function createWslWorkerTransport(opts: {
  distro: string
  wslCwd: string
  workerWslPath: string
}): WorkerTransport {
  const child = spawnWorkerInWsl(opts)
  let messageCb: ((message: WorkerResponsePayload) => void) | null = null
  let exitCb: ((code: number) => void) | null = null
  let stdoutCb: ((chunk: string) => void) | null = null
  let stderrCb: ((chunk: string) => void) | null = null
  let frameBuffer = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    frameBuffer += chunk.toString()
    let idx = frameBuffer.indexOf('\n')
    while (idx >= 0) {
      const line = frameBuffer.slice(0, idx)
      frameBuffer = frameBuffer.slice(idx + 1)
      const msg = decodeWorkerFrameLine(line)
      if (msg) {
        messageCb?.(msg as WorkerResponsePayload)
      } else if (line.trim()) {
        stderrCb?.(`[wsl-stdout] ${line}\n`)
      }
      idx = frameBuffer.indexOf('\n')
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrCb?.(chunk.toString())
  })
  child.on('error', (err) => {
    stderrCb?.(`[wsl] ${String(err?.message ?? err)}\n`)
    exitCb?.(-1)
  })
  child.on('exit', (code) => {
    exitCb?.(code ?? -1)
  })

  return {
    kind: 'wsl',
    get pid() {
      return child.pid
    },
    postMessage: (message) => {
      if (child.stdin?.writable) {
        child.stdin.write(JSON.stringify(message) + '\n')
      }
    },
    onMessage: (cb) => {
      messageCb = cb
    },
    onExit: (cb) => {
      exitCb = cb
    },
    onStdout: (cb) => {
      stdoutCb = cb
    },
    onStderr: (cb) => {
      stderrCb = cb
    },
    kill: () => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    },
  }
}
