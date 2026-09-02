// Pi Worker - runs pi SDK in a utilityProcess via MessagePort, or inside WSL
// over a stdio JSONL channel (PI_WORKER_STDIO=1).
process.env.ELECTRON_RUN_AS_NODE = '1'

import { errorMessage } from '@shared/error-message'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import { handleWorkerPortMessage } from './worker-port-handlers.js'
import {
  attachWorkerStdioListener,
  routeWorkerLogsToStderr,
  sendToMain,
  workerStdioMode,
} from './worker-transport.js'
import { translateIncomingPaths, translateOutgoingPaths } from './worker-path-bridge.js'
import './worker-runtime.js'

routeWorkerLogsToStderr()

process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err)
  if (msg.includes('stale') && (msg.includes('extension ctx') || msg.includes('ExtensionRunner'))) {
    console.warn('[Worker] swallowed stale extension ctx error:', msg)
    return
  }
  console.error('[Worker] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  const msg = errorMessage(reason)
  if (msg.includes('stale') && msg.includes('extension ctx')) return
  console.error('[Worker] unhandledRejection:', reason)
})

async function handleIncomingMessage(
  msg: WorkerIncomingMessage | undefined | null,
): Promise<void> {
  if (!msg || typeof msg !== 'object' || !msg.type) return
  // Avoid per-RPC production logging; retain errors via uncaught handlers below.
  // 高频轮询类 RPC（getState / getSessionContextPreview）在开发模式也静音，避免刷屏。
  if (msg.type === 'getState' || msg.type === 'getSessionContextPreview') {
    // 静音：跳过下方 dev 跟踪
  } else if (process.env.NODE_ENV !== 'production' || process.env.PI_WORKER_TRACE === '1') {
    console.log('[Worker] Received:', msg.type)
  }
  const translated = translateIncomingPaths(msg)
  const reply = (payload: Record<string, unknown>) => {
    sendToMain({ requestId: msg?.requestId, ...translateOutgoingPaths(payload) })
  }

  await handleWorkerPortMessage(translated, reply)
}

if (!workerStdioMode) {
  // In utilityProcess, parentPort messages come as MessageEvent with data property
  process.parentPort?.on(
    'message',
    (event: { data?: WorkerIncomingMessage } | WorkerIncomingMessage) => {
      const msg =
        typeof event === 'object' && event !== null && 'data' in event
          ? (event as { data?: WorkerIncomingMessage }).data
          : event
      void handleIncomingMessage(msg)
    },
  )
} else {
  attachWorkerStdioListener((msg) => void handleIncomingMessage(msg))
}

if (process.env.NODE_ENV !== 'production' || process.env.PI_WORKER_TRACE === '1') {
  console.log('[Worker] Ready')
}
