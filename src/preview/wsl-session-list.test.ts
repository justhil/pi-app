import { beforeEach, describe, expect, it, vi } from 'vitest'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const mocks = vi.hoisted(() => ({
  sessionList: vi.fn(),
}))

vi.mock('node:url', () => ({
  pathToFileURL: () => ({ href: 'file:///tmp/wsl-preview-sdk.mjs' }),
}))
vi.mock('file:///tmp/wsl-preview-sdk.mjs', () => ({
  SessionManager: { list: mocks.sessionList },
}))

import {
  invalidateListSessionsCache,
  listSessionsOnDisk,
} from './wsl-session-list'

describe('WSL preview session list cache', () => {
  beforeEach(() => {
    invalidateListSessionsCache()
    mocks.sessionList.mockReset()
  })

  it('does not let an in-flight list repopulate an invalidated workspace cache', async () => {
    const firstList = deferred<unknown[]>()
    mocks.sessionList
      .mockReturnValueOnce(firstList.promise)
      .mockResolvedValueOnce([{ id: 'after', path: '/home/u/.pi/agent/sessions/after.jsonl' }])

    const stale = listSessionsOnDisk('/home/u/project', '/opt/pi/dist/index.js')
    await vi.waitFor(() => expect(mocks.sessionList).toHaveBeenCalledTimes(1))
    invalidateListSessionsCache('/home/u/project')
    firstList.resolve([{ id: 'before', path: '/home/u/.pi/agent/sessions/before.jsonl' }])

    await expect(stale).resolves.toMatchObject([{ id: 'before' }])
    await expect(listSessionsOnDisk('/home/u/project', '/opt/pi/dist/index.js'))
      .resolves.toMatchObject([{ id: 'after' }])
    expect(mocks.sessionList).toHaveBeenCalledTimes(2)
  })
})
