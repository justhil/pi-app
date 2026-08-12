import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { encodeWorkerFrame } from '@shared/worker-frame'

const mocks = vi.hoisted(() => ({
  spawnWorkerInWsl: vi.fn(),
}))

vi.mock('./wsl/worker-host', () => ({ spawnWorkerInWsl: mocks.spawnWorkerInWsl }))

import { createWslWorkerTransport } from './worker-transport'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = 42
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

function splitInsideFirstMultibyte(buffer: Buffer): number {
  for (let index = 1; index < buffer.length; index++) {
    if ((buffer[index] & 0xc0) === 0x80) return index
  }
  throw new Error('fixture has no multibyte boundary')
}

describe('WSL worker transport UTF-8 framing', () => {
  it('should_preserve_multibyte_text_when_stdout_frame_is_split_between_chunks', async () => {
    const child = fakeChild()
    mocks.spawnWorkerInWsl.mockReturnValue(child)
    const transport = createWslWorkerTransport({
      distro: 'Ubuntu',
      wslCwd: '/home/u/project',
      workerWslPath: '/home/u/worker.mjs',
    })
    const received = vi.fn()
    transport.onMessage(received)

    const frame = Buffer.from(
      `${encodeWorkerFrame({ type: 'response', requestId: 'r1', result: { preview: '这是最新回复' } })}\n`,
    )
    const split = splitInsideFirstMultibyte(frame)
    child.stdout.write(frame.subarray(0, split))
    child.stdout.write(frame.subarray(split))

    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
    expect(received.mock.calls[0][0]).toMatchObject({
      result: { preview: '这是最新回复' },
    })
  })
})
