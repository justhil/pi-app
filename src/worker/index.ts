// Pi Worker - runs pi SDK in a utilityProcess via MessagePort
process.env.ELECTRON_RUN_AS_NODE = '1'

import { errorMessage } from '@shared/error-message'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import { handleWorkerPortMessage } from './worker-port-handlers.js'
import './worker-runtime.js'

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

// In utilityProcess, parentPort messages come as MessageEvent with data property
process.parentPort?.on('message', async (event: { data?: WorkerIncomingMessage } | WorkerIncomingMessage) => {
  const msg = (typeof event === 'object' && event !== null && 'data' in event
    ? (event as { data?: WorkerIncomingMessage }).data
    : event) as WorkerIncomingMessage
  console.log('[Worker] Received:', msg?.type)
  const reply = (payload: Record<string, unknown>) => {
    process.parentPort?.postMessage({ requestId: msg?.requestId, ...payload })
  }


  await handleWorkerPortMessage(msg, reply)
})

console.log('[Worker] Ready')
