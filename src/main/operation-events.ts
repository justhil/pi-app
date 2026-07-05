import log from 'electron-log'

export type OperationEvent = {
  operation: string
  status: 'start' | 'ok' | 'error' | 'timeout'
  durationMs?: number
  detail?: string
}

export function emitOperationEvent(event: OperationEvent): void {
  const line = `[op] ${event.operation} ${event.status}${event.durationMs != null ? ` ${event.durationMs}ms` : ''}${event.detail ? ` ${event.detail}` : ''}`
  if (event.status === 'error' || event.status === 'timeout') {
    log.warn(line)
  } else {
    log.info(line)
  }
}

export async function withOperationEvent<T>(
  operation: string,
  fn: () => Promise<T>,
  opts?: { timeoutDetail?: string },
): Promise<T> {
  const started = Date.now()
  emitOperationEvent({ operation, status: 'start' })
  try {
    const result = await fn()
    emitOperationEvent({ operation, status: 'ok', durationMs: Date.now() - started })
    return result
  } catch (e) {
    const detail = opts?.timeoutDetail || String(e)
    const status = detail.includes('timeout') || detail.includes('aborted') ? 'timeout' : 'error'
    emitOperationEvent({ operation, status, durationMs: Date.now() - started, detail })
    throw e
  }
}