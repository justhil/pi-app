import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  invalidateListSessionsCache,
  listSessionsOnDisk,
  toSessionOnDiskRows,
  validateSelectedSdkModule,
} from './sdk-session'

vi.mock('../sdk-loader', () => ({
  resolveActiveSdk: vi.fn(() => ({
    kind: 'builtin',
    entryPath: '/tmp/pi-desktop-test/sdk.mjs',
    version: '0.0.0',
  })),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const sdkList = vi.fn(async () => [
  { id: 'h1', path: '/root/workspace/pi-app/.pi/s1.json' },
])

vi.mock('/tmp/pi-desktop-test/sdk.mjs', () => ({
  SessionManager: { list: sdkList },
}))

describe('selected SDK module probe', () => {
  it('rejects the legacy factory shape without ModelRuntime services', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
        createAgentSession: () => ({}),
      }),
    ).toThrow('SDK 缺少 ModelRuntime session services')
  })

  it('accepts the runtime session factory capability shape', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
        ModelRuntime: class {},
        createAgentSessionRuntime: () => ({}),
        createAgentSessionServices: () => ({}),
        createAgentSessionFromServices: () => ({}),
      }),
    ).not.toThrow()
  })

  it('rejects a partial SDK without a usable session factory', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
        createAgentSessionRuntime: () => ({}),
      }),
    ).toThrow('SDK 缺少 ModelRuntime session services')
  })
})

describe('listSessionsOnDisk preview inputs', () => {
  beforeEach(() => {
    invalidateListSessionsCache()
    sdkList.mockReset()
    sdkList.mockResolvedValue([
      { id: 'h1', path: '/root/workspace/pi-app/.pi/s1.json' },
    ])
  })

  it('loads host sessions from the selected SDK', async () => {
    const result = await listSessionsOnDisk('/root/workspace/pi-app', '/tmp/pi-desktop-test')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('h1')
    expect(sdkList).toHaveBeenCalledWith('/root/workspace/pi-app')
  })

  it('reflects a successful mutation on the next list request', async () => {
    sdkList
      .mockResolvedValueOnce([{ id: 'before', path: '/root/workspace/pi-app/.pi/before.json' }])
      .mockResolvedValueOnce([{ id: 'after', path: '/root/workspace/pi-app/.pi/after.json' }])

    await expect(listSessionsOnDisk('/root/workspace/pi-app', '/tmp/pi-desktop-test'))
      .resolves.toMatchObject([{ id: 'before' }])
    invalidateListSessionsCache('/root/workspace/pi-app')
    await expect(listSessionsOnDisk('/root/workspace/pi-app', '/tmp/pi-desktop-test'))
      .resolves.toMatchObject([{ id: 'after' }])
    expect(sdkList).toHaveBeenCalledTimes(2)
  })

  it('does not let an in-flight list repopulate an invalidated workspace cache', async () => {
    const firstList = deferred<{ id: string; path: string }[]>()
    sdkList
      .mockReturnValueOnce(firstList.promise)
      .mockResolvedValueOnce([{ id: 'after', path: '/root/workspace/pi-app/.pi/after.json' }])

    const stale = listSessionsOnDisk('/root/workspace/pi-app', '/tmp/pi-desktop-test')
    await vi.waitFor(() => expect(sdkList).toHaveBeenCalledTimes(1))
    invalidateListSessionsCache('/root/workspace/pi-app')
    firstList.resolve([{ id: 'before', path: '/root/workspace/pi-app/.pi/before.json' }])

    await expect(stale).resolves.toMatchObject([{ id: 'before' }])
    await expect(listSessionsOnDisk('/root/workspace/pi-app', '/tmp/pi-desktop-test'))
      .resolves.toMatchObject([{ id: 'after' }])
    expect(sdkList).toHaveBeenCalledTimes(2)
  })

  it('normalizes WSL worker rows without importing a Worker manager', async () => {
    const rows = [
      {
        id: 's1',
        sessionFile: '\\\\wsl.localhost\\Debian\\root\\x\\.pi\\s1.json',
        created: '2026-08-11T00:00:00.000Z',
      },
    ]
    const result = await listSessionsOnDisk(
      '\\\\wsl.localhost\\Debian\\root\\x',
      '/tmp/pi-desktop-test',
      rows,
    )
    expect(result[0]).toMatchObject({ id: 's1', path: rows[0].sessionFile })
    expect(result[0].created).toBeInstanceOf(Date)
    expect(sdkList).not.toHaveBeenCalled()
  })

  it('normalizes invalid and sparse rows consistently', () => {
    expect(toSessionOnDiskRows([null, { id: 1, path: 2 }])).toEqual([
      { id: '1', path: '2' },
    ])
  })
})
