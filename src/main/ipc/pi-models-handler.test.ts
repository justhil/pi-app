import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  readModelsConfig: vi.fn(),
  writeModelsConfig: vi.fn(),
  reloadModels: vi.fn(),
  stopPreview: vi.fn(),
  installVersion: vi.fn(),
  switchTo: vi.fn(),
  confirmSdkSelection: vi.fn(),
  readSdkStatusCached: vi.fn(),
  listRegistryVersions: vi.fn(),
  isAllowedSdkVersion: vi.fn(),
  workerRunning: true,
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
  sendEvent: vi.fn(),
}))

vi.mock('../pi-models-json', () => ({
  readModelsConfig: mocks.readModelsConfig,
  writeModelsConfig: mocks.writeModelsConfig,
  fetchRemoteModelIds: vi.fn(),
}))

vi.mock('../worker-manager', () => ({
  workerManager: {
    get isRunning() {
      return mocks.workerRunning
    },
    reloadModels: mocks.reloadModels,
    hasActiveTurns: false,
    cwd: '',
    lastSdkFallback: false,
  },
}))

vi.mock('../config-store', () => ({ configStore: { get: vi.fn(() => '') } }))
vi.mock('../pi-info', () => ({ readPiInfo: vi.fn(), readResourceList: vi.fn() }))
vi.mock('../sdk-loader', () => ({ clearGlobalSdkPathCache: vi.fn() }))
vi.mock('../sdk-manager', () => ({
  readSdkStatusCached: mocks.readSdkStatusCached,
  listRegistryVersionsCached: vi.fn(),
  listRegistryVersions: mocks.listRegistryVersions,
  installVersion: mocks.installVersion,
  switchTo: mocks.switchTo,
  isAllowedSdkVersion: mocks.isAllowedSdkVersion,
  invalidateSdkManagerCaches: vi.fn(),
}))
vi.mock('./sdk-session', () => ({ probeSelectedSdk: vi.fn() }))
vi.mock('../sdk-selection-transaction', () => ({ confirmSdkSelection: mocks.confirmSdkSelection }))
vi.mock('../session-preview-process', () => ({
  sessionPreviewProcess: { stop: mocks.stopPreview },
}))
vi.mock('../wsl/runtime-config', () => ({
  getAgentRuntimeConfig: vi.fn(() => ({ mode: 'host', distro: null })),
}))
vi.mock('../wsl/sdk-resolve', () => ({ assertWslSdkAvailable: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: { getFocusedWindow: vi.fn(), getAllWindows: vi.fn(() => []) },
}))

import { registerPiSdkHandlers } from './handlers/pi-sdk'

const config = {
  providers: {
    custom: {
      name: 'Custom provider',
      baseUrl: 'https://example.invalid/v1',
      models: [{ id: 'model-a' }],
    },
  },
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.readModelsConfig.mockReset()
  mocks.writeModelsConfig.mockReset()
  mocks.reloadModels.mockReset()
  mocks.stopPreview.mockReset()
  mocks.installVersion.mockReset()
  mocks.installVersion.mockResolvedValue(undefined)
  mocks.switchTo.mockReset()
  mocks.switchTo.mockResolvedValue(undefined)
  mocks.confirmSdkSelection.mockReset()
  mocks.confirmSdkSelection.mockResolvedValue({ kind: 'builtin', version: '0.83.0' })
  mocks.readSdkStatusCached.mockReset()
  mocks.readSdkStatusCached.mockReturnValue({ active: { kind: 'builtin' } })
  mocks.listRegistryVersions.mockReset()
  mocks.listRegistryVersions.mockResolvedValue(['0.83.0'])
  mocks.isAllowedSdkVersion.mockReset()
  mocks.isAllowedSdkVersion.mockReturnValue(true)
  mocks.workerRunning = true
  registerPiSdkHandlers()
})

describe('pi.models IPC handlers', () => {
  it.each([
    ['ipc:sdk.install', { version: '0.83.0' }],
    ['ipc:sdk.switch', { target: 'builtin' }],
  ])('stops preview before %s changes the selected SDK', async (channel, request) => {
    const order: string[] = []
    mocks.stopPreview.mockImplementation(() => order.push('preview-stop'))
    mocks.installVersion.mockImplementation(async () => { order.push('install') })
    mocks.switchTo.mockImplementation(async () => { order.push('switch') })

    await expect(mocks.handlers.get(channel)!(request)).resolves.toMatchObject({ ok: true })

    expect(order[0]).toBe('preview-stop')
    expect(order).toContain(channel === 'ipc:sdk.install' ? 'install' : 'switch')
  })

  it('writes through the production owner and reloads the running Worker before success', async () => {
    mocks.writeModelsConfig.mockResolvedValue({ ok: true, path: 'active-agent/models.json' })
    mocks.reloadModels.mockResolvedValue(undefined)

    const response = await mocks.handlers.get('ipc:pi.models.set')!({ config })

    expect(mocks.writeModelsConfig).toHaveBeenCalledWith(config)
    expect(mocks.reloadModels).toHaveBeenCalledOnce()
    expect(response).toEqual({ ok: true, path: 'active-agent/models.json' })
  })

  it('returns an explicit failure when the file was written but Worker reload fails', async () => {
    mocks.writeModelsConfig.mockResolvedValue({ ok: true, path: 'active-agent/models.json' })
    mocks.reloadModels.mockRejectedValue(new Error('reload failed'))

    const response = await mocks.handlers.get('ipc:pi.models.set')!({ config })

    expect(response).toEqual({
      ok: false,
      path: 'active-agent/models.json',
      error: '模型配置已写入，但重载失败: reload failed',
    })
  })

  it('returns the same active configuration owner used by the get handler', async () => {
    mocks.readModelsConfig.mockResolvedValue({
      path: 'active-agent/models.json',
      config,
      warnings: ['normalized'],
    })

    const response = await mocks.handlers.get('ipc:pi.models.get')!({})

    expect(mocks.readModelsConfig).toHaveBeenCalledOnce()
    expect(response).toEqual({
      path: 'active-agent/models.json',
      config,
      parseError: undefined,
      schemaError: undefined,
      warnings: ['normalized'],
    })
  })
})
