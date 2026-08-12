import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  abort: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (
    channel: string,
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => mocks.handlers.set(channel, handler),
  registerHandlerWithSchema: vi.fn(),
}))
vi.mock('../../worker-manager', () => ({
  workerManager: {
    abort: mocks.abort,
    getState: mocks.getState,
  },
}))
vi.mock('../../session-bind-state', () => ({
  ensureWorkerSessionBound: vi.fn(),
}))
vi.mock('../../clipboard-temp-images', () => ({
  writeClipboardTempImage: vi.fn(),
}))

import { registerPromptHandlers } from './prompt'

describe('prompt.abort session isolation', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.abort.mockReset()
    mocks.getState.mockReset()
    registerPromptHandlers()
  })

  it('rejects an abort request without a session file instead of targeting foreground', async () => {
    const handler = mocks.handlers.get('ipc:prompt.abort')
    expect(handler).toBeDefined()

    const result = await handler!({ sessionId: '' })

    expect(result).toEqual({
      aborted: false,
      ignored: true,
      reason: 'session_required',
    })
    expect(mocks.abort).not.toHaveBeenCalled()
  })

  it('aborts only the explicitly requested session', async () => {
    const handler = mocks.handlers.get('ipc:prompt.abort')!
    mocks.getState.mockResolvedValue({
      sessionFile: '/sessions/current.jsonl',
      isStreaming: true,
    })

    const result = await handler({
      sessionId: 'current',
      sessionFile: '/sessions/current.jsonl',
    })

    expect(result).toEqual({ aborted: true })
    expect(mocks.abort).toHaveBeenCalledWith('/sessions/current.jsonl')
  })
})
