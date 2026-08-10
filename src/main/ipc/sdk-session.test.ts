import { describe, expect, it, vi, beforeEach } from 'vitest'
import { validateSelectedSdkModule, listSessionsOnDisk, invalidateListSessionsCache } from './sdk-session'

vi.mock('../worker-manager', () => ({
  workerManager: {
    listSessions: vi.fn(async () => []),
  },
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/pi-desktop-test') },
}))

vi.mock('../wsl/runtime-config', () => ({
  isWslRuntimeActive: vi.fn(() => false),
}))

vi.mock('../sdk-loader', () => ({
  resolveActiveSdk: vi.fn(() => ({ kind: 'builtin', entryPath: '/tmp/pi-desktop-test/sdk.mjs', version: '0.0.0' })),
}))

vi.mock('/tmp/pi-desktop-test/sdk.mjs', () => ({
  SessionManager: {
    list: vi.fn(async () => [
      { id: 'h1', path: '/root/workspace/pi-app/.pi/s1.json' },
    ]),
  },
}))

import { workerManager } from '../worker-manager'
import { isWslRuntimeActive } from '../wsl/runtime-config'
const mockIsWslRuntimeActive = isWslRuntimeActive as unknown as ReturnType<typeof vi.fn>
const mockListSessions = workerManager.listSessions as unknown as ReturnType<typeof vi.fn>

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

describe('listSessionsOnDisk WSL routing', () => {
  beforeEach(() => {
    mockListSessions.mockClear()
    mockListSessions.mockResolvedValue([])
    invalidateListSessionsCache()
  })

  it('routes host-mode native paths to direct SDK read (worker not consulted)', async () => {
    mockIsWslRuntimeActive.mockReturnValue(false)
    const result = await listSessionsOnDisk('/root/workspace/pi-app')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('h1')
    expect(mockListSessions).not.toHaveBeenCalled()
  })

  it('routes UNC paths through the worker channel in host mode', async () => {
    mockIsWslRuntimeActive.mockReturnValue(false)
    mockListSessions.mockResolvedValue([
      { id: 's1', path: '\\\\wsl.localhost\\Debian\\root\\x\\.pi\\s1.json' },
    ])
    const result = await listSessionsOnDisk('\\\\wsl.localhost\\Debian\\root\\x')
    expect(mockListSessions).toHaveBeenCalledWith('\\\\wsl.localhost\\Debian\\root\\x')
    expect(result[0].path).toContain('\\\\wsl.localhost\\Debian\\root\\x')
  })

  it('routes Windows sandbox paths through the worker channel while WSL runtime is active', async () => {
    mockIsWslRuntimeActive.mockReturnValue(true)
    mockListSessions.mockResolvedValue([
      {
        id: 's1',
        path: 'C:\\Users\\T\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\781ac8c3\\s1.json',
      },
    ])
    const result = await listSessionsOnDisk(
      'C:\\Users\\T\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\781ac8c3',
    )
    expect(mockListSessions).toHaveBeenCalledWith(
      'C:\\Users\\T\\AppData\\Roaming\\pi-desktop\\sandbox-workspaces\\781ac8c3',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
  })

  it('falls back to an empty list when the worker channel throws', async () => {
    mockIsWslRuntimeActive.mockReturnValue(true)
    mockListSessions.mockRejectedValue(new Error('boom'))
    const result = await listSessionsOnDisk('\\\\wsl.localhost\\Debian\\root\\x')
    expect(result).toEqual([])
  })
})
