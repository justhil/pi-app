import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: Record<string, unknown>) => Promise<unknown>>(),
  runtime: { mode: 'wsl' as 'host' | 'wsl', distro: 'Ubuntu' as string | null },
  previewListModels: vi.fn(),
  getActiveSdkModule: vi.fn(),
  listAvailableModelsWithSdk: vi.fn(),
  listCatalogModelsWithSdk: vi.fn(),
  readModelsConfigRaw: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../registry', () => ({
  registerHandler: (name: string, handler: (req: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, handler),
  registerHandlerWithSchema: (name: string, _schema: unknown, handler: (req: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, handler),
}))
vi.mock('../../worker-manager', () => ({ workerManager: { isRunning: false, cwd: null } }))
vi.mock('../../config-store', () => ({ configStore: { get: vi.fn() } }))
vi.mock('../../sandbox-workspaces', () => ({ isSandboxWorkspacePath: () => false }))
vi.mock('../../pi-models-json', () => ({
  readModelsConfigRaw: mocks.readModelsConfigRaw,
  modelsCatalogFromConfig: (config: { models?: unknown[] }) => config.models ?? [],
}))
vi.mock('../sdk-session', () => ({ getActiveSdkModule: mocks.getActiveSdkModule }))
vi.mock('../../session-context-preview', () => ({ getSessionContextPreviewFromDisk: vi.fn() }))
vi.mock('../../session-leaf-override', () => ({ getSessionLeafOverride: vi.fn() }))
vi.mock('../../trusted-workspace', () => ({ authorizeTrustedSessionFile: vi.fn() }))
vi.mock('../../wsl/runtime-config', () => ({
  isWslRuntimeActive: () => mocks.runtime.mode === 'wsl' && !!mocks.runtime.distro,
  getAgentRuntimeConfig: () => ({ ...mocks.runtime }),
}))
vi.mock('../../agent-dir', () => ({ resolveActiveAgentDir: () => '/host/.pi/agent' }))
vi.mock('../../session-preview-process', () => ({ sessionPreviewProcess: { listModels: mocks.previewListModels } }))
vi.mock('../../active-sdk-models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../active-sdk-models')>()),
  listAvailableModelsWithSdk: mocks.listAvailableModelsWithSdk,
  listCatalogModelsWithSdk: mocks.listCatalogModelsWithSdk,
}))

import { registerModelRuntimeHandlers } from './model-runtime'

const hostModel = { id: 'windows-only', name: 'Windows', provider: 'host-provider' }
const wslModel = { id: 'wsl-model', name: 'WSL', provider: 'wsl-provider' }
const list = (scope: string) => mocks.handlers.get('ipc:model.list')!({ scope }) as Promise<{ models: Array<{ id: string }> }>

beforeEach(() => {
  mocks.handlers.clear()
  mocks.runtime = { mode: 'wsl', distro: 'Ubuntu' }
  for (const mock of [mocks.previewListModels, mocks.getActiveSdkModule, mocks.listAvailableModelsWithSdk, mocks.listCatalogModelsWithSdk, mocks.readModelsConfigRaw]) mock.mockReset()
  mocks.getActiveSdkModule.mockResolvedValue({ host: true })
  mocks.listAvailableModelsWithSdk.mockResolvedValue([hostModel])
  mocks.listCatalogModelsWithSdk.mockResolvedValue([hostModel])
  mocks.readModelsConfigRaw.mockReturnValue({ path: '//wsl/models.json', config: { models: [wslModel] } })
  registerModelRuntimeHandlers()
})

describe('R12 model list stays inside the active runtime', () => {
  it('should_return_empty_available_without_host_sdk_when_wsl_preview_fails', async () => {
    mocks.previewListModels.mockRejectedValue(new Error('WSL preview exited'))
    await expect(list('available')).resolves.toEqual({ models: [] })
    expect(mocks.getActiveSdkModule).not.toHaveBeenCalled()
  })

  it('should_use_same_environment_catalog_without_host_sdk_when_wsl_preview_fails', async () => {
    mocks.previewListModels.mockRejectedValue(new Error('WSL preview exited'))
    const result = await list('catalog')
    expect(result.models.map((model) => model.id)).toEqual(['wsl-model'])
    expect(mocks.getActiveSdkModule).not.toHaveBeenCalled()
  })

  it('should_return_wsl_preview_models_when_preview_succeeds', async () => {
    mocks.previewListModels.mockResolvedValue([wslModel])
    const result = await list('available')
    expect(result.models.map((model) => model.id)).toEqual(['wsl-model'])
    expect(mocks.previewListModels).toHaveBeenCalledWith('available', '')
  })

  it('should_keep_host_sdk_fallback_when_host_preview_fails', async () => {
    mocks.runtime = { mode: 'host', distro: null }
    mocks.previewListModels.mockRejectedValue(new Error('preview crashed'))
    const result = await list('available')
    expect(result.models.map((model) => model.id)).toEqual(['windows-only'])
    expect(mocks.previewListModels).toHaveBeenCalledWith('available', '/host/.pi/agent')
  })

  it('should_drop_result_when_runtime_switches_while_request_is_pending', async () => {
    mocks.runtime = { mode: 'host', distro: null }
    mocks.previewListModels.mockImplementation(async () => {
      mocks.runtime = { mode: 'wsl', distro: 'Ubuntu' }
      return [hostModel]
    })
    await expect(list('available')).resolves.toEqual({ models: [] })
    expect(mocks.getActiveSdkModule).not.toHaveBeenCalled()
  })
})
