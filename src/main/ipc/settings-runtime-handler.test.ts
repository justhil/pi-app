import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  currentRuntime: { mode: 'host' as 'host' | 'wsl', distro: null as string | null },
  configSet: vi.fn(),
  stop: vi.fn(async () => {}),
  hasActiveTurns: false,
  invalidateAdapterCatalog: vi.fn(),
  invalidateSdkManagerCaches: vi.fn(),
  invalidateListSessionsCache: vi.fn(),
}))

vi.mock('./registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
  registerHandlerWithSchema: (
    channel: string,
    _schema: unknown,
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, handler)
  },
}))

vi.mock('../config-store', () => ({
  configStore: {
    get: vi.fn((key: string) => (key === 'agentRuntime' ? mocks.currentRuntime : undefined)),
    getAll: vi.fn(() => ({ agentRuntime: mocks.currentRuntime })),
    set: mocks.configSet,
  },
}))

vi.mock('../worker-manager', () => ({
  workerManager: {
    get hasActiveTurns() {
      return mocks.hasActiveTurns
    },
    stop: mocks.stop,
  },
}))

vi.mock('../../extension-compat/adapter-loader', () => ({
  invalidateAdapterCatalog: mocks.invalidateAdapterCatalog,
}))

vi.mock('../sdk-manager', () => ({
  invalidateSdkManagerCaches: mocks.invalidateSdkManagerCaches,
}))

vi.mock('./sdk-session', () => ({
  invalidateListSessionsCache: mocks.invalidateListSessionsCache,
}))

vi.mock('../asr-config-store', () => ({
  asrConfigForSettingsResponse: vi.fn((value) => value),
  loadAsrConfig: vi.fn(() => ({})),
  saveAsrConfig: vi.fn(),
}))

vi.mock('../window', () => ({ getMainWindow: vi.fn(() => null) }))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

import { registerSettingsHandlers } from './handlers/settings'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.currentRuntime = { mode: 'host', distro: null }
  mocks.configSet.mockReset()
  mocks.stop.mockReset()
  mocks.stop.mockResolvedValue(undefined)
  mocks.hasActiveTurns = false
  mocks.invalidateAdapterCatalog.mockReset()
  mocks.invalidateSdkManagerCaches.mockReset()
  mocks.invalidateListSessionsCache.mockReset()
  registerSettingsHandlers()
})

describe('agent runtime settings transaction', () => {
  it('should_reject_agent_runtime_change_while_turn_is_active', async () => {
    mocks.hasActiveTurns = true

    await expect(
      mocks.handlers.get('ipc:settings.set')!({
        key: 'agentRuntime',
        value: { mode: 'wsl', distro: 'Debian' },
      }),
    ).rejects.toThrow('AGENT_RUNTIME_BUSY')

    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.configSet).not.toHaveBeenCalled()
  })

  it('should_dispose_idle_workers_before_persisting_agent_runtime_change', async () => {
    const order: string[] = []
    mocks.stop.mockImplementation(async () => {
      order.push('stop')
    })
    mocks.configSet.mockImplementation(() => {
      order.push('persist')
    })

    await mocks.handlers.get('ipc:settings.set')!({
      key: 'agentRuntime',
      value: { mode: 'wsl', distro: 'Debian' },
    })

    expect(order).toEqual(['stop', 'persist'])
    expect(mocks.invalidateAdapterCatalog).toHaveBeenCalledOnce()
    expect(mocks.invalidateSdkManagerCaches).toHaveBeenCalledOnce()
    expect(mocks.invalidateListSessionsCache).toHaveBeenCalledOnce()
  })

  it('should_not_restart_workers_when_agent_runtime_is_unchanged', async () => {
    await mocks.handlers.get('ipc:settings.set')!({
      key: 'agentRuntime',
      value: { mode: 'host', distro: null },
    })

    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.configSet).toHaveBeenCalledWith('agentRuntime', { mode: 'host', distro: null })
  })
})
