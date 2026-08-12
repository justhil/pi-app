import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
  resolveUtilityEntry: vi.fn(() => 'C:\\app\\preview.mjs'),
  resolveActiveSdk: vi.fn(() => ({ kind: 'builtin' as const, entryPath: 'builtin' })),
  isWslRuntimeActive: vi.fn(() => false),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:\\data') },
  utilityProcess: { fork: mocks.fork },
}))
vi.mock('./utility-entry-path', () => ({ resolveUtilityEntry: mocks.resolveUtilityEntry }))
vi.mock('./sdk-loader', () => ({ resolveActiveSdk: mocks.resolveActiveSdk }))
vi.mock('./wsl/runtime-config', () => ({ isWslRuntimeActive: mocks.isWslRuntimeActive }))
vi.mock('./operation-events', () => ({ emitOperationEvent: vi.fn() }))

import { SessionPreviewProcess } from './session-preview-process'

function fakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    postMessage: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.postMessage = vi.fn()
  proc.kill = vi.fn()
  return proc
}

describe('Host session preview process lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.fork.mockReset()
    mocks.resolveActiveSdk.mockReset()
    mocks.resolveActiveSdk.mockReturnValue({ kind: 'builtin', entryPath: 'builtin' })
    mocks.isWslRuntimeActive.mockReset()
    mocks.isWslRuntimeActive.mockReturnValue(false)
  })

  it('does not create unhandled rejections when stopped while idle or stopped repeatedly', async () => {
    const preview = new SessionPreviewProcess()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    try {
      preview.stop()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])

      preview.stop()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('routes settings writes through the host preview process without an AgentSession', async () => {
    const proc = fakeProcess()
    const preview = new SessionPreviewProcess()
    mocks.fork.mockReturnValueOnce(proc)

    const request = preview.setPiSettings({ defaultProvider: 'openai', defaultModel: 'gpt-5' }, 'C:\\Project')
    await vi.waitFor(() => expect(proc.postMessage).toHaveBeenCalledOnce())
    const message = proc.postMessage.mock.calls[0][0] as { requestId: string }
    proc.emit('message', { requestId: message.requestId, ok: true, result: null })

    await expect(request).resolves.toBeNull()
    expect(proc.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pi.settings.set',
      payload: {
        cwd: 'C:\\Project',
        patch: { defaultProvider: 'openai', defaultModel: 'gpt-5' },
      },
    }))
  })

  it('rejects a request when stop fires while a deferred active-SDK resolution is in progress', async () => {
    vi.useFakeTimers()
    const proc = fakeProcess()
    const preview = new SessionPreviewProcess()
    let release!: () => void
    const activeSdk = new Promise<{ kind: 'builtin'; entryPath: string }>((resolve) => {
      release = () => resolve({ kind: 'builtin', entryPath: 'builtin' })
    })
    mocks.fork.mockReturnValueOnce(proc)
    mocks.resolveActiveSdk.mockReturnValueOnce(activeSdk as unknown as ReturnType<typeof mocks.resolveActiveSdk>)

    const request = preview.listSessions('/foreground')
    await vi.waitFor(() => expect(mocks.resolveActiveSdk).toHaveBeenCalledOnce())
    preview.stop()
    release()

    await expect(request).rejects.toThrow('Preview process stopped')
    expect(proc.kill).toHaveBeenCalledOnce()
    expect(proc.postMessage).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(preview.inspectLifecycleForTest()).toEqual({ process: false, pending: 0 })
  })
})
