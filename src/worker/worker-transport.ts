/**
 * Worker-side message transport.
 *
 * In Electron utilityProcess mode messages go over `process.parentPort`
 * (Electron MessagePort). Inside WSL there is no parentPort, so we fall back
 * to a newline-delimited JSON channel on stdout/stdin (see worker-frame).
 */

import { encodeWorkerFrame } from '@shared/worker-frame'
import { WORKER_STDIO_ENV } from '@shared/worker-frame'
import type { WorkerIncomingMessage } from './worker-port-types.js'

export const workerStdioMode = process.env[WORKER_STDIO_ENV] === '1'

/**
 * Post a payload to main. In stdio mode the frame is written to stdout with a
 * magic prefix so stray log lines on stdout never corrupt the channel.
 */
export function sendToMain(payload: Record<string, unknown>): void {
  if (workerStdioMode) {
    process.stdout.write(encodeWorkerFrame(payload) + '\n')
    return
  }
  process.parentPort?.postMessage(payload)
}

/**
 * Redirect worker console output to stderr in stdio mode so stdout stays a
 * clean JSONL channel. Must be called before any SDK code logs to stdout.
 */
export function routeWorkerLogsToStderr(): void {
  if (!workerStdioMode) return
  console.log = (...args: unknown[]) => console.warn('[Worker]', ...args)
}

export function attachWorkerStdioListener(
  handler: (msg: WorkerIncomingMessage) => void,
): void {
  if (!workerStdioMode) return
  let buffer = ''
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.trim()) {
        try {
          handler(JSON.parse(line) as WorkerIncomingMessage)
        } catch (e) {
          console.warn('[Worker] Dropping malformed stdin frame:', e)
        }
      }
      idx = buffer.indexOf('\n')
    }
  })
  process.stdin.on('end', () => {
    process.exit(0)
  })
}
