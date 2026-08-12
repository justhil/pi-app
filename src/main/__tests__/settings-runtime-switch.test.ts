import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreSchema } from '../config-store'
import type { AgentRuntimeConfig } from '../wsl/runtime-config'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (req: unknown) => Promise<unknown>>()
  return {
    handlers,
    stop: vi.fn(),
    invalidateAdapterCatalog: vi.fn(),
    invalidateSdkManagerCaches: vi.fn(),
    invalidateListSessionsCache: vi.fn(),
    getAgentRuntimeConfig: vi.fn(),
    configGet: vi.fn(),
    configSet: vi.fn(),
    ipcMain: {
      handle: (channel: string, h: (event: unknown, req: unknown) => Promise<unknown>) => {
        handlers.set(channel, (req) => h(undefined, req))
      },
      removeHandler: vi.fn(),
    },
    shell: { openExternal: vi.fn() },
  }
})

vi.mock('electron', () => ({ shell: mocks.shell, ipcMain: mocks.ipcMain }))
vi.mock('../worker-manager', () => ({ workerManager: { stop: mocks.stop, hasActiveTurns: false } }))
vi.mock('../../extension-compat/adapter-loader', () => ({
  invalidateAdapterCatalog: mocks.invalidateAdapterCatalog,
}))
vi.mock('../sdk-manager', () => ({ invalidateSdkManagerCaches: mocks.invalidateSdkManagerCaches }))
vi.mock('../sdk-session', () => ({ invalidateListSessionsCache: mocks.invalidateListSessionsCache }))
vi.mock('../wsl/runtime-config', () => ({ getAgentRuntimeConfig: mocks.getAgentRuntimeConfig }))
vi.mock('../config-store', () => ({
  configStore: {
    get: mocks.configGet,
    getAll: vi.fn(() => ({})),
    set: mocks.configSet,
  },
}))
vi.mock('../asr-config-store', () => ({
  asrConfigForSettingsResponse: (v: unknown) => v,
  loadAsrConfig: () => ({}),
  saveAsrConfig: vi.fn(),
}))
vi.mock('../window', () => ({ getMainWindow: () => null }))
vi.mock('../registry', () => ({
  registerHandler: (channel: string, h: (req: unknown) => Promise<unknown>) => {
    mocks.handlers.set(channel, h)
  },
  registerHandlerWithSchema: (channel: string, _schema: unknown, h: (req: unknown) => Promise<unknown>) => {
    mocks.handlers.set(channel, h)
  },
}))

import { registerSettingsHandlers } from '../ipc/handlers/settings'

function setAgentRuntime(prev: AgentRuntimeConfig, next: AgentRuntimeConfig): Promise<unknown> {
  mocks.configGet.mockReturnValue(prev)
  const handler = mocks.handlers.get('ipc:settings.set')!
  return handler({ key: 'agentRuntime', value: next })
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.stop.mockReset()
  mocks.invalidateAdapterCatalog.mockReset()
  mocks.invalidateSdkManagerCaches.mockReset()
  mocks.invalidateListSessionsCache.mockReset()
  mocks.configGet.mockReset()
  mocks.configSet.mockReset()
  registerSettingsHandlers()
})

describe('ipc:settings.set agentRuntime', () => {
  it('stops the worker pool when switching host → wsl', async () => {
    await setAgentRuntime(
      { mode: 'host', distro: null },
      { mode: 'wsl', distro: 'Debian' },
    )
    expect(mocks.invalidateAdapterCatalog).toHaveBeenCalledTimes(1)
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('stops the worker pool when switching wsl → host', async () => {
    await setAgentRuntime(
      { mode: 'wsl', distro: 'Debian' },
      { mode: 'host', distro: null },
    )
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('stops the worker pool when the distro changes', async () => {
    await setAgentRuntime(
      { mode: 'wsl', distro: 'Debian' },
      { mode: 'wsl', distro: 'Ubuntu' },
    )
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps the pool when the runtime is unchanged (re-save)', async () => {
    await setAgentRuntime(
      { mode: 'wsl', distro: 'Debian' },
      { mode: 'wsl', distro: 'Debian' },
    )
    expect(mocks.invalidateAdapterCatalog).not.toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('does not touch the worker pool for unrelated settings keys', async () => {
    mocks.getAgentRuntimeConfig.mockReturnValue({ mode: 'host', distro: null })
    const handler = mocks.handlers.get('ipc:settings.set')!
    await handler({ key: 'theme', value: 'dark' } as unknown as { key: string; value: StoreSchema['theme'] })
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.invalidateAdapterCatalog).not.toHaveBeenCalled()
  })
})
