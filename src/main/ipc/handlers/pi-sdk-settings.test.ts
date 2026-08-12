import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  setPiSettings: vi.fn(),
  writePiAgentGlobalSettings: vi.fn(),
}))

vi.mock('../registry', () => ({
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
  sendEvent: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/user-data') },
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => null) },
}))
vi.mock('../../worker-manager', () => ({
  workerManager: {
    isRunning: false,
    hasActiveTurns: false,
    setPiSettings: mocks.setPiSettings,
    getPiSettings: vi.fn(),
    reloadModels: vi.fn(),
  },
}))
vi.mock('../../config-store', () => ({ configStore: { get: vi.fn(() => null) } }))
vi.mock('../../pi-info', () => ({ readPiInfo: vi.fn(), readResourceList: vi.fn() }))
vi.mock('../../pi-models-json', () => ({
  readModelsConfig: vi.fn(),
  writeModelsConfig: vi.fn(),
  fetchRemoteModelIds: vi.fn(),
}))
vi.mock('../../sdk-loader', () => ({
  clearGlobalSdkPathCache: vi.fn(),
  readSdkSelection: vi.fn(() => ({ kind: 'builtin' })),
}))
vi.mock('../../sdk-manager', () => ({
  readSdkStatusCached: vi.fn(),
  readWslSdkStatusCached: vi.fn(),
  listRegistryVersionsCached: vi.fn(),
  listRegistryVersions: vi.fn(),
  installVersion: vi.fn(),
  finalizeVersionInstall: vi.fn(),
  switchTo: vi.fn(),
  isAllowedSdkVersion: vi.fn(),
  invalidateSdkManagerCaches: vi.fn(),
}))
vi.mock('../../sdk-selection-transaction', () => ({ confirmSdkSelection: vi.fn() }))
vi.mock('../sdk-session', () => ({ probeSelectedSdk: vi.fn() }))
vi.mock('../../wsl/runtime-config', () => ({ getAgentRuntimeConfig: vi.fn(() => ({ mode: 'host', distro: null })) }))
vi.mock('../../wsl/sdk-resolve', () => ({ assertWslSdkAvailable: vi.fn() }))
vi.mock('../../session-preview-process', () => ({ sessionPreviewProcess: { stop: vi.fn() } }))
vi.mock('../../pi-agent-settings-write', () => ({
  writePiAgentGlobalSettings: mocks.writePiAgentGlobalSettings,
}))

import { registerPiSdkHandlers } from './pi-sdk'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.setPiSettings.mockReset()
  mocks.writePiAgentGlobalSettings.mockReset()
  registerPiSdkHandlers()
})

describe('Pi settings persistence without a Worker', () => {
  it('should_persist_global_settings_when_worker_is_not_started', async () => {
    const result = await mocks.handlers.get('ipc:pi.settings.set')!({
      patch: { defaultProvider: 'openai', defaultModel: 'gpt-5' },
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.writePiAgentGlobalSettings).toHaveBeenCalledWith({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5',
    })
    expect(mocks.setPiSettings).not.toHaveBeenCalled()
  })
})
