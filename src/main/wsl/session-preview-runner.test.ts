import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { encodeWorkerFrame } from '@shared/worker-frame'

const mocks = vi.hoisted(() => ({
  getAgentRuntimeConfig: vi.fn(() => ({ mode: 'wsl' as const, distro: 'Ubuntu' })),
  resolveWslActiveSdk: vi.fn(),
  syncPreviewBundleToWsl: vi.fn(),
  spawnPreviewInWsl: vi.fn(),
}))

vi.mock('./runtime-config', () => ({ getAgentRuntimeConfig: mocks.getAgentRuntimeConfig }))
vi.mock('./sdk-resolve', () => ({ resolveWslActiveSdk: mocks.resolveWslActiveSdk }))
vi.mock('./preview-host', () => ({
  syncPreviewBundleToWsl: mocks.syncPreviewBundleToWsl,
  spawnPreviewInWsl: mocks.spawnPreviewInWsl,
}))

import { WslSessionPreviewRunner } from './session-preview-runner'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

describe('WSL session preview runner', () => {
  beforeEach(() => {
    mocks.getAgentRuntimeConfig.mockReset()
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: 'Ubuntu' })
    mocks.resolveWslActiveSdk.mockReset()
    mocks.resolveWslActiveSdk.mockResolvedValue({ entryPath: '/opt/pi/dist/index.js' })
    mocks.syncPreviewBundleToWsl.mockReset()
    mocks.syncPreviewBundleToWsl.mockReturnValue('/home/u/.pi-desktop/preview-wsl.mjs')
    mocks.spawnPreviewInWsl.mockReset()
  })

  it('does not create unhandled rejections when stopped while idle or stopped repeatedly', async () => {
    const runner = new WslSessionPreviewRunner()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    try {
      runner.stop()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])

      runner.stop()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('rejects immediately and does not spawn when stopped during SDK resolution', async () => {
    const sdk = deferred<{ entryPath: string } | null>()
    mocks.resolveWslActiveSdk.mockReturnValueOnce(sdk.promise)
    const runner = new WslSessionPreviewRunner()
    const request = runner.request({
      type: 'session.list',
      payload: { cwd: 'C:\\Project', workspaceId: 'C:\\Project' },
      userDataDir: 'C:\\data',
    })
    const rejection = expect(request).rejects.toThrow('WSL preview stopped')

    await vi.waitFor(() => expect(mocks.resolveWslActiveSdk).toHaveBeenCalledOnce())
    runner.stop()
    await rejection
    sdk.resolve({ entryPath: '/opt/pi/dist/index.js' })
    await Promise.resolve()

    expect(mocks.syncPreviewBundleToWsl).not.toHaveBeenCalled()
    expect(mocks.spawnPreviewInWsl).not.toHaveBeenCalled()
  })

  it('writes Pi settings through the WSL-native preview process', async () => {
    const child = fakeChild()
    mocks.spawnPreviewInWsl.mockReturnValue(child)
    let written = ''
    child.stdin.on('data', (chunk) => {
      written += chunk.toString()
      const request = JSON.parse(written.trim()) as { requestId: string; type: string }
      child.stdout.write(encodeWorkerFrame({
        requestId: request.requestId,
        type: `${request.type}-done`,
        result: null,
      }) + '\n')
    })
    const runner = new WslSessionPreviewRunner()

    await expect(runner.request({
      type: 'pi.settings.set',
      payload: {
        cwd: 'C:\\Project',
        patch: { defaultProvider: 'openai', defaultModel: 'gpt-5' },
      },
      userDataDir: 'C:\\data',
    })).resolves.toBeNull()

    expect(JSON.parse(written.trim())).toMatchObject({
      type: 'pi.settings.set',
      cwd: '/mnt/c/Project',
      patch: { defaultProvider: 'openai', defaultModel: 'gpt-5' },
      sdkPath: '/opt/pi/dist/index.js',
    })
  })

  it('uses native WSL paths and returns without touching AgentSession or worker pools', async () => {
    const child = fakeChild()
    mocks.spawnPreviewInWsl.mockReturnValue(child)
    let written = ''
    child.stdin.on('data', (chunk) => {
      written += chunk.toString()
      const request = JSON.parse(written.trim()) as { requestId: string }
      child.stdout.write(encodeWorkerFrame({
        requestId: request.requestId,
        type: 'session.list-done',
        result: [{ id: 's1', path: '/home/u/.pi/agent/sessions/s1.jsonl' }],
      }) + '\n')
    })
    const pool = new Map<string, unknown>([['existing', {}]])
    const agentSession = { create: vi.fn(), bind: vi.fn() }
    const runner = new WslSessionPreviewRunner()

    await expect(runner.request({
      type: 'session.list',
      payload: { cwd: 'C:\\Project', workspaceId: 'C:\\Project' },
      userDataDir: 'C:\\Users\\u\\AppData\\Roaming\\pi-desktop',
    })).resolves.toEqual([{ id: 's1', path: '/home/u/.pi/agent/sessions/s1.jsonl' }])

    expect(mocks.spawnPreviewInWsl).toHaveBeenCalledWith({
      distro: 'Ubuntu',
      wslCwd: '/mnt/c/Project',
      previewWslPath: '/home/u/.pi-desktop/preview-wsl.mjs',
    })
    expect(JSON.parse(written.trim())).toMatchObject({
      type: 'session.list',
      cwd: '/mnt/c/Project',
      workspaceId: '/mnt/c/Project',
      sdkPath: '/opt/pi/dist/index.js',
    })
    expect(agentSession.create).not.toHaveBeenCalled()
    expect(agentSession.bind).not.toHaveBeenCalled()
    expect([...pool.keys()]).toEqual(['existing'])
  })

  it('reuses the dedicated preview process without allocating additional processes', async () => {
    const child = fakeChild()
    mocks.spawnPreviewInWsl.mockReturnValue(child)
    child.stdin.on('data', (chunk) => {
      const request = JSON.parse(chunk.toString()) as { requestId: string; type: string }
      child.stdout.write(encodeWorkerFrame({
        requestId: request.requestId,
        type: `${request.type}-done`,
        result: request.type === 'session.tree' ? { nodes: [], leafId: null } : { items: [], totalCount: 0 },
      }) + '\n')
    })
    const runner = new WslSessionPreviewRunner()

    await runner.request({
      type: 'session.tree',
      payload: { cwd: '\\\\wsl.localhost\\Ubuntu\\home\\u\\project', sessionFile: '\\\\wsl.localhost\\Ubuntu\\home\\u\\s.jsonl' },
      userDataDir: 'C:\\data',
    })
    await runner.request({
      type: 'session.getMessages',
      payload: { cwd: '\\\\wsl.localhost\\Ubuntu\\home\\u\\project', sessionFile: '\\\\wsl.localhost\\Ubuntu\\home\\u\\s.jsonl', offset: 0 },
      userDataDir: 'C:\\data',
    })

    expect(mocks.spawnPreviewInWsl).toHaveBeenCalledTimes(1)
    expect(mocks.spawnPreviewInWsl).toHaveBeenCalledWith(expect.objectContaining({ wslCwd: '/home/u/project' }))
  })

  it('replaces the process when the distro changes at the same cwd', async () => {
    const childA = fakeChild()
    const childB = fakeChild()
    mocks.spawnPreviewInWsl.mockReturnValueOnce(childA).mockReturnValueOnce(childB)
    for (const child of [childA, childB]) {
      child.stdin.on('data', (chunk) => {
        const request = JSON.parse(chunk.toString()) as { requestId: string; type: string }
        child.stdout.write(encodeWorkerFrame({
          requestId: request.requestId,
          type: `${request.type}-done`,
          result: [],
        }) + '\n')
      })
    }
    const runner = new WslSessionPreviewRunner()

    await runner.request({
      type: 'session.list',
      payload: { cwd: 'C:\\Project', workspaceId: 'C:\\Project' },
      userDataDir: 'C:\\data',
    })
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'wsl', distro: 'Debian' })
    await runner.request({
      type: 'session.list',
      payload: { cwd: 'C:\\Project', workspaceId: 'C:\\Project' },
      userDataDir: 'C:\\data',
    })

    expect(childA.kill).toHaveBeenCalledOnce()
    expect(mocks.spawnPreviewInWsl).toHaveBeenNthCalledWith(2, expect.objectContaining({
      distro: 'Debian',
      wslCwd: '/mnt/c/Project',
    }))
  })

  it('rejects a pending request before replacing the process for another cwd', async () => {
    const childA = fakeChild()
    const childB = fakeChild()
    mocks.spawnPreviewInWsl.mockReturnValueOnce(childA).mockReturnValueOnce(childB)
    childB.stdin.on('data', (chunk) => {
      const request = JSON.parse(chunk.toString()) as { requestId: string; type: string }
      childB.stdout.write(encodeWorkerFrame({
        requestId: request.requestId,
        type: `${request.type}-done`,
        result: [],
      }) + '\n')
    })
    const runner = new WslSessionPreviewRunner()
    const pendingA = runner.request({
      type: 'session.list',
      payload: { cwd: 'C:\\ProjectA', workspaceId: 'C:\\ProjectA' },
      userDataDir: 'C:\\data',
    })
    const pendingARejection = expect(pendingA).rejects.toThrow('WSL preview cwd changed')
    await vi.waitFor(() => expect(childA.stdin.readableLength).toBeGreaterThan(0))

    const requestB = runner.request({
      type: 'session.list',
      payload: { cwd: 'C:\\ProjectB', workspaceId: 'C:\\ProjectB' },
      userDataDir: 'C:\\data',
    })

    await pendingARejection
    await expect(requestB).resolves.toEqual([])
    expect(childA.kill).toHaveBeenCalledOnce()
    expect(mocks.spawnPreviewInWsl).toHaveBeenCalledTimes(2)
  })
})
