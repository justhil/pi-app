import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  readModelsConfig: vi.fn(),
  writeModelsConfig: vi.fn(),
  reloadModels: vi.fn(),
  sendEvent: vi.fn(),
  getAllWindows: vi.fn(() => [] as Array<{ id: number }>),
  readSdkStatusCached: vi.fn(),
  listRegistryVersionsCached: vi.fn(),
  listRegistryVersions: vi.fn(),
  installVersion: vi.fn(),
  finalizeVersionInstall: vi.fn(),
  readSdkSelection: vi.fn(),
  getFocusedWindow: vi.fn(() => undefined as { id: number } | undefined),
  switchTo: vi.fn(),
  isAllowedSdkVersion: vi.fn(),
  confirmSdkSelection: vi.fn(),
  stopPreview: vi.fn(),
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
  sendEvent: mocks.sendEvent,
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
vi.mock('../sdk-loader', () => ({
  clearGlobalSdkPathCache: vi.fn(),
  readSdkSelection: mocks.readSdkSelection,
}))
vi.mock('../sdk-manager', () => ({
  readSdkStatusCached: mocks.readSdkStatusCached,
  listRegistryVersionsCached: mocks.listRegistryVersionsCached,
  listRegistryVersions: mocks.listRegistryVersions,
  installVersion: mocks.installVersion,
  finalizeVersionInstall: mocks.finalizeVersionInstall,
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
  BrowserWindow: { getFocusedWindow: mocks.getFocusedWindow, getAllWindows: mocks.getAllWindows },
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
  mocks.sendEvent.mockReset()
  mocks.getAllWindows.mockReset().mockReturnValue([])
  mocks.readSdkStatusCached.mockReset().mockReturnValue({ active: { kind: 'builtin' } })
  mocks.listRegistryVersionsCached.mockReset()
  mocks.listRegistryVersions.mockReset().mockResolvedValue(['0.83.0'])
  mocks.installVersion.mockReset().mockResolvedValue({ userDir: 'user-new' })
  mocks.finalizeVersionInstall.mockReset()
  mocks.readSdkSelection.mockReset().mockReturnValue({ kind: 'builtin' })
  mocks.getFocusedWindow.mockReset().mockReturnValue(undefined)
  mocks.switchTo.mockReset().mockResolvedValue(undefined)
  mocks.isAllowedSdkVersion.mockReset().mockReturnValue(true)
  mocks.confirmSdkSelection.mockReset().mockResolvedValue({ kind: 'builtin', version: '0.83.0' })
  mocks.stopPreview.mockReset()
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
    mocks.installVersion.mockImplementation(async () => {
      order.push('install')
      return { userDir: 'user-new' }
    })
    mocks.switchTo.mockImplementation(async () => {
      order.push('switch')
    })

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

  it('notifies every renderer only after an SDK install succeeds', async () => {
    const windows = [{ id: 1 }, { id: 2 }]
    mocks.getAllWindows.mockReturnValue(windows)
    mocks.getFocusedWindow.mockReturnValue(windows[0])
    mocks.installVersion.mockResolvedValue({ userDir: 'user-new' })
    mocks.confirmSdkSelection.mockResolvedValue({ kind: 'user', version: '0.83.0' })

    const response = await mocks.handlers.get('ipc:sdk.install')!({ version: '0.83.0' })

    expect(response).toEqual({ ok: true, active: { kind: 'user', version: '0.83.0' } })
    expect(mocks.finalizeVersionInstall).toHaveBeenCalledWith('user-new', true)
    expect(mocks.sendEvent.mock.calls.slice(-2)).toEqual([
      [windows[0], { type: 'sdk-runtime-changed' }],
      [windows[1], { type: 'sdk-runtime-changed' }],
    ])
  })

  it('passes the exact previous user generation into install rollback', async () => {
    mocks.readSdkSelection.mockReturnValue({ kind: 'user', userDir: 'user-old' })
    mocks.installVersion.mockResolvedValue({ userDir: 'user-new' })
    mocks.confirmSdkSelection.mockRejectedValue(new Error('Worker validation failed'))

    const response = await mocks.handlers.get('ipc:sdk.install')!({ version: '0.83.0' })

    expect(response).toEqual({ ok: false, error: 'Worker validation failed' })
    expect(mocks.confirmSdkSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'user',
        rollbackTarget: { kind: 'user', userDir: 'user-old' },
      }),
    )
    expect(mocks.finalizeVersionInstall).toHaveBeenCalledWith('user-new', false)
  })

  it('notifies every renderer only after an SDK switch succeeds', async () => {
    const windows = [{ id: 1 }, { id: 2 }]
    mocks.getAllWindows.mockReturnValue(windows)
    mocks.confirmSdkSelection.mockResolvedValue({ kind: 'global', version: '0.83.0' })

    const response = await mocks.handlers.get('ipc:sdk.switch')!({ target: 'global' })

    expect(response).toEqual({ ok: true, active: { kind: 'global', version: '0.83.0' } })
    expect(mocks.sendEvent.mock.calls).toEqual([
      [windows[0], { type: 'sdk-runtime-changed' }],
      [windows[1], { type: 'sdk-runtime-changed' }],
    ])
  })

  it('does not notify renderers when an SDK switch fails', async () => {
    mocks.switchTo.mockRejectedValue(new Error('switch failed'))

    const response = await mocks.handlers.get('ipc:sdk.switch')!({ target: 'global' })

    expect(response).toEqual({ ok: false, error: 'switch failed' })
    expect(mocks.sendEvent).not.toHaveBeenCalled()
  })
})
