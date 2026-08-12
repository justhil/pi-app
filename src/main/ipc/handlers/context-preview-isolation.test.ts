import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request?: Record<string, unknown>) => Promise<unknown>>(),
  getSettingsSnapshot: vi.fn(),
  getSessionContextPreview: vi.fn(),
  getSessionContextPreviewFromDisk: vi.fn(),
  getSessionLeafOverride: vi.fn(),
  authorizeTrustedSessionFile: vi.fn(),
  isWslRuntimeActive: vi.fn(),
  listAvailableModelsWithSdk: vi.fn<() => Promise<unknown[]>>(async () => []),
  listCatalogModelsWithSdk: vi.fn<() => Promise<unknown[]>>(async () => []),
  resolveAvailableModels: vi.fn<() => Promise<unknown[]>>(async () => []),
  resolveCatalogModels: vi.fn(async (input: { sdk: () => Promise<unknown[]> }) => input.sdk()),
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request?: Record<string, unknown>) => Promise<unknown>) =>
    mocks.handlers.set(channel, handler),
  registerHandlerWithSchema: (
    channel: string,
    schema: {
      safeParse: (request: unknown) => {
        success: boolean
        data?: Record<string, unknown>
      }
    },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) =>
    mocks.handlers.set(channel, async (request) => {
      const parsed = schema.safeParse(request)
      if (!parsed.success) throw new Error(`Invalid IPC input for ${channel}`)
      return handler(parsed.data || {})
    }),
}))

vi.mock('../../worker-manager', () => ({
  workerManager: {
    isRunning: false,
    cwd: null,
    getModelSettingsSnapshot: mocks.getSettingsSnapshot,
    getSessionContextPreview: mocks.getSessionContextPreview,
  },
}))

vi.mock('../../config-store', () => ({
  configStore: { get: vi.fn(() => undefined) },
}))

vi.mock('../../sandbox-workspaces', () => ({
  isSandboxWorkspacePath: vi.fn(() => false),
}))

vi.mock('../../pi-models-json', () => ({
  readModelsConfigRaw: vi.fn(() => ({ config: {}, parseError: null })),
  modelsCatalogFromConfig: vi.fn(() => []),
}))

vi.mock('../../active-sdk-models', () => ({
  listAvailableModelsWithSdk: mocks.listAvailableModelsWithSdk,
  listCatalogModelsWithSdk: mocks.listCatalogModelsWithSdk,
  resolveAvailableModels: mocks.resolveAvailableModels,
  resolveCatalogModels: mocks.resolveCatalogModels,
}))

vi.mock('../../session-leaf-override', () => ({
  getSessionLeafOverride: mocks.getSessionLeafOverride,
}))

vi.mock('../../session-context-preview', () => ({
  getSessionContextPreviewFromDisk: mocks.getSessionContextPreviewFromDisk,
}))

vi.mock('../../wsl/runtime-config', () => ({
  isWslRuntimeActive: mocks.isWslRuntimeActive,
}))

vi.mock('../../trusted-workspace', () => ({
  authorizeTrustedSessionFile: mocks.authorizeTrustedSessionFile,
}))

vi.mock('../sdk-session', () => ({
  getActiveSdkModule: vi.fn(async () => ({})),
}))

import { workerManager } from '../../worker-manager'
import { registerModelRuntimeHandlers } from './model-runtime'

describe('context.preview session isolation', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.getSettingsSnapshot.mockReset()
    mocks.getSessionContextPreview.mockReset()
    mocks.getSessionContextPreviewFromDisk.mockReset()
    mocks.getSessionLeafOverride.mockReset()
    mocks.authorizeTrustedSessionFile.mockReset()
    mocks.isWslRuntimeActive.mockReset()
    mocks.listAvailableModelsWithSdk.mockReset().mockResolvedValue([])
    mocks.listCatalogModelsWithSdk.mockReset().mockResolvedValue([])
    mocks.resolveAvailableModels.mockReset().mockResolvedValue([])
    mocks.resolveCatalogModels
      .mockReset()
      .mockImplementation(async (input: { sdk: () => Promise<unknown[]> }) => input.sdk())
    mocks.isWslRuntimeActive.mockReturnValue(false)
    mocks.authorizeTrustedSessionFile.mockImplementation((_workspaceId, sessionFile) => ({
      ok: true,
      cwd: '/workspace',
      sessionFile,
    }))
    ;(workerManager as { isRunning: boolean }).isRunning = false
    registerModelRuntimeHandlers()
  })

  it('prefers the live Worker settings snapshot without loading an SDK in Main', async () => {
    const workerModel = {
      id: 'worker-model',
      provider: 'worker-provider',
      available: false,
      managedBy: 'active-sdk',
      auth: { supported: true, configured: false },
    }
    ;(workerManager as { isRunning: boolean }).isRunning = true
    mocks.getSettingsSnapshot.mockResolvedValue([workerModel])

    const result = await mocks.handlers.get('ipc:model.list')!({
      scope: 'settings',
    })

    expect(result).toEqual({ models: [expect.objectContaining(workerModel)] })
    expect(mocks.getSettingsSnapshot).toHaveBeenCalledOnce()
    expect(mocks.listCatalogModelsWithSdk).not.toHaveBeenCalled()
    expect(mocks.resolveCatalogModels).not.toHaveBeenCalled()
    expect(mocks.listAvailableModelsWithSdk).not.toHaveBeenCalled()
  })

  it('falls back from a failed Worker settings snapshot to the non-network Main catalog', async () => {
    const catalogModel = {
      id: 'claude',
      provider: 'anthropic',
      available: false,
      managedBy: 'active-sdk',
      auth: { supported: true, configured: false },
    }
    ;(workerManager as { isRunning: boolean }).isRunning = true
    mocks.getSettingsSnapshot.mockRejectedValue(new Error('worker failed'))
    mocks.listCatalogModelsWithSdk.mockResolvedValue([catalogModel])

    const result = await mocks.handlers.get('ipc:model.list')!({
      scope: 'settings',
    })

    expect(result).toEqual({ models: [expect.objectContaining(catalogModel)] })
    expect(mocks.getSettingsSnapshot).toHaveBeenCalledOnce()
    expect(mocks.listCatalogModelsWithSdk).toHaveBeenCalledOnce()
    expect(mocks.listAvailableModelsWithSdk).not.toHaveBeenCalled()
  })

  it('keeps available Composer scope separate from the non-network Settings snapshot', async () => {
    const catalogModel = {
      id: 'claude',
      provider: 'anthropic',
      available: false,
      managedBy: 'active-sdk',
      auth: { supported: true, configured: false },
    }
    mocks.listCatalogModelsWithSdk.mockResolvedValue([catalogModel])

    const result = await mocks.handlers.get('ipc:model.list')!({
      scope: 'settings',
    })

    expect(result).toEqual({
      models: [expect.objectContaining(catalogModel)],
    })
    expect(mocks.listCatalogModelsWithSdk).toHaveBeenCalledOnce()
    expect(mocks.listAvailableModelsWithSdk).not.toHaveBeenCalled()
    expect(mocks.resolveAvailableModels).not.toHaveBeenCalled()
  })

  it('keeps catalog scope available while Settings uses its separate snapshot scope', async () => {
    mocks.listCatalogModelsWithSdk.mockResolvedValue([
      {
        id: 'claude',
        provider: 'anthropic',
        available: false,
        managedBy: 'active-sdk',
        auth: { supported: true, configured: false },
      },
    ])

    const result = await mocks.handlers.get('ipc:model.list')!({
      scope: 'catalog',
    })

    expect(result).toEqual({
      models: [
        expect.objectContaining({
          id: 'claude',
          provider: 'anthropic',
          available: true,
        }),
      ],
    })
    expect((result as { models: unknown[] }).models[0]).not.toHaveProperty('auth')
    expect((result as { models: unknown[] }).models[0]).not.toHaveProperty('managedBy')
    expect(mocks.listAvailableModelsWithSdk).not.toHaveBeenCalled()
  })

  it('queries the live preview only for the requested session', async () => {
    const sessionFile = '/sessions/target.jsonl'
    ;(workerManager as { isRunning: boolean }).isRunning = true
    mocks.getSessionContextPreview.mockImplementation(async (requested?: string) => ({
      sessionFile: requested || '/sessions/foreground.jsonl',
      messageCount: 1,
      estimatedChars: requested ? 22 : 11,
    }))

    const result = await mocks.handlers.get('ipc:context.preview')!({
      sessionFile,
      workspaceId: '/workspace',
    })

    expect(mocks.getSessionContextPreview).toHaveBeenCalledWith(sessionFile)
    expect(mocks.authorizeTrustedSessionFile).toHaveBeenCalledWith('/workspace', sessionFile)
    expect(result).toEqual({
      preview: expect.objectContaining({ sessionFile, estimatedChars: 22 }),
    })
  })

  it('reads an idle session from disk without requiring a running worker', async () => {
    const sessionFile = '/sessions/idle.jsonl'
    mocks.getSessionContextPreview.mockResolvedValue(null)
    mocks.getSessionLeafOverride.mockReturnValue('rewound-leaf')
    mocks.getSessionContextPreviewFromDisk.mockReturnValue({
      sessionId: 'idle-session',
      sessionFile,
      messageCount: 1,
      estimatedChars: 12,
    })

    const result = await mocks.handlers.get('ipc:context.preview')!({
      sessionFile,
      workspaceId: '/workspace',
    })

    expect(mocks.authorizeTrustedSessionFile).toHaveBeenCalledWith('/workspace', sessionFile)
    expect(mocks.getSessionContextPreviewFromDisk).toHaveBeenCalledWith(sessionFile, 'rewound-leaf')
    expect(result).toEqual({
      preview: expect.objectContaining({
        sessionFile,
        sessionId: 'idle-session',
        messageCount: 1,
        estimatedChars: 12,
      }),
    })
  })

  it('does not open a session file outside the active trusted workspace', async () => {
    mocks.authorizeTrustedSessionFile.mockReturnValue({
      ok: false,
      error: 'session_workspace_mismatch',
    })

    const result = await mocks.handlers.get('ipc:context.preview')!({
      sessionFile: '/other/session.jsonl',
      workspaceId: '/workspace',
    })

    expect(result).toEqual({ preview: null })
    expect(mocks.getSessionContextPreview).not.toHaveBeenCalled()
    expect(mocks.getSessionContextPreviewFromDisk).not.toHaveBeenCalled()
  })

  it('authorizes before reading a live worker preview', async () => {
    const sessionFile = '/other/live.jsonl'
    ;(workerManager as { isRunning: boolean }).isRunning = true
    mocks.authorizeTrustedSessionFile.mockReturnValue({
      ok: false,
      error: 'session_workspace_mismatch',
    })
    mocks.getSessionContextPreview.mockResolvedValue({
      sessionFile,
      messageCount: 1,
      estimatedChars: 99,
    })

    const result = await mocks.handlers.get('ipc:context.preview')!({
      sessionFile,
      workspaceId: '/workspace',
    })

    expect(result).toEqual({ preview: null })
    expect(mocks.getSessionContextPreview).not.toHaveBeenCalled()
  })

  it('does not use the host SDK disk fallback while WSL runtime is active', async () => {
    const sessionFile = '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\sessions\\idle.jsonl'
    mocks.isWslRuntimeActive.mockReturnValue(true)
    mocks.getSessionContextPreview.mockResolvedValue(null)

    const result = await mocks.handlers.get('ipc:context.preview')!({
      sessionFile,
      workspaceId: 'C:\\workspace',
    })

    expect(result).toEqual({ preview: null })
    expect(mocks.getSessionContextPreviewFromDisk).not.toHaveBeenCalled()
  })
})
