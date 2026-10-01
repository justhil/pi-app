import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { encodeWorkerFrame } from '@shared/worker-frame'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), spawn: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/data' }, utilityProcess: { fork: mocks.fork } }))
vi.mock('../utility-entry-path', () => ({ resolveUtilityEntry: () => 'preview.mjs' }))
vi.mock('../sdk-loader', () => ({ resolveActiveSdk: () => ({ kind: 'builtin', entryPath: 'builtin' }) }))
vi.mock('../wsl/runtime-config', () => ({
  isWslRuntimeActive: () => false,
  getAgentRuntimeConfig: () => ({ mode: 'wsl', distro: 'Ubuntu' }),
}))
vi.mock('../wsl/sdk-resolve', () => ({ resolveWslActiveSdk: async () => ({ entryPath: '/sdk/index.js' }) }))
vi.mock('../wsl/preview-host', () => ({ syncPreviewBundleToWsl: async () => '/preview.mjs', spawnPreviewInWsl: mocks.spawn }))
vi.mock('../operation-events', () => ({ emitOperationEvent: vi.fn() }))

import { SessionPreviewProcess } from '../session-preview-process'
import { WslSessionPreviewRunner } from '../wsl/session-preview-runner'

type Mode = 'host' | 'wsl'
type FakeProc = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  postMessage: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  sent: Array<Record<string, unknown>>
  reply: (requestId: string, result: unknown) => void
}

function fakeProc(mode: Mode, { exitOnKill }: { exitOnKill: boolean }): FakeProc {
  const proc = new EventEmitter() as FakeProc
  proc.stdin = new PassThrough()
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.sent = []
  proc.postMessage = vi.fn((message: Record<string, unknown>) => proc.sent.push(message))
  proc.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) if (line.trim()) proc.sent.push(JSON.parse(line))
  })
  proc.kill = vi.fn(() => {
    if (exitOnKill) proc.emit('exit', 1)
  })
  proc.reply = (requestId, result) => {
    if (mode === 'host') proc.emit('message', { requestId, ok: true, result })
    else proc.stdout.write(`${encodeWorkerFrame({ requestId, type: 'session.list-done', result })}\n`)
  }
  return proc
}

function harness(mode: Mode, exitOnKill: boolean) {
  const procs: FakeProc[] = []
  const factory = () => {
    const proc = fakeProc(mode, { exitOnKill })
    procs.push(proc)
    return proc
  }
  mocks.fork.mockImplementation(factory)
  mocks.spawn.mockImplementation(factory)
  const preview = mode === 'host' ? new SessionPreviewProcess() : new WslSessionPreviewRunner()
  const request = () => preview instanceof SessionPreviewProcess
    ? preview.listSessions('/workspace')
    : preview.request({ type: 'session.list', payload: { cwd: '/workspace' }, userDataDir: '/data' })
  const track = <T,>(promise: Promise<T>) => {
    const state = { settled: false, error: null as Error | null, value: undefined as unknown }
    promise.then((value) => { state.value = value }, (error: Error) => { state.error = error }).finally(() => { state.settled = true })
    return state
  }
  return { preview, request, track, procs }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  mocks.fork.mockReset()
  mocks.spawn.mockReset()
})

describe.each(['host', 'wsl'] as const)('R6 %s preview process termination', (mode) => {
  it.each([true, false])('should_reject_all_requests_of_killed_process_when_one_times_out (exit on kill: %s)', async (exitOnKill) => {
    // Given: two requests waiting on the same preview process
    const { request, track } = harness(mode, exitOnKill)
    const first = track(request())
    await vi.advanceTimersByTimeAsync(1_000)
    const second = track(request())
    await vi.advanceTimersByTimeAsync(0)

    // When: the first request reaches its deadline and the process is killed
    await vi.advanceTimersByTimeAsync(119_000)

    // Then: the second request ends immediately and no timer stays behind
    expect(first.error?.message).toContain('timed out')
    expect(second.settled).toBe(true)
    expect(second.error).toBeInstanceOf(Error)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('should_reject_all_owned_requests_and_clear_timers_when_process_exits', async () => {
    const { request, track, procs } = harness(mode, false)
    const a = track(request())
    const b = track(request())
    await vi.advanceTimersByTimeAsync(0)
    procs[0].emit('exit', 3)
    await vi.advanceTimersByTimeAsync(0)
    expect(a.error?.message).toContain('3')
    expect(b.error?.message).toContain('3')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('should_keep_new_process_requests_when_old_process_exits_late', async () => {
    // Given: the old process was killed on timeout but has not emitted exit yet
    const { request, track, procs } = harness(mode, false)
    const stale = track(request())
    await vi.advanceTimersByTimeAsync(120_000)
    expect(stale.error?.message).toContain('timed out')
    const fresh = track(request())
    await vi.advanceTimersByTimeAsync(0)
    expect(procs).toHaveLength(2)

    // When: the old process finally exits
    procs[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(0)

    // Then: the new process request is untouched and still completes
    expect(fresh.settled).toBe(false)
    const requestId = String(procs[1].sent.at(-1)?.requestId)
    procs[1].reply(requestId, [])
    await vi.advanceTimersByTimeAsync(0)
    expect(fresh.error).toBeNull()
    expect(fresh.settled).toBe(true)
  })

  it('should_reject_pending_and_clear_timers_when_stopped', async () => {
    const { preview, request, track } = harness(mode, false)
    const a = track(request())
    await vi.advanceTimersByTimeAsync(0)
    preview.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(a.error?.message).toContain('stopped')
    expect(vi.getTimerCount()).toBe(0)
  })
})
