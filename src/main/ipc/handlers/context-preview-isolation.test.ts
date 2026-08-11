import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request?: Record<string, unknown>) => Promise<unknown>>(),
  getSessionContextPreview: vi.fn(),
  getSessionContextPreviewFromDisk: vi.fn(),
  getSessionLeafOverride: vi.fn(),
  authorizeTrustedSessionFile: vi.fn(),
  isWslRuntimeActive: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (
    channel: string,
    handler: (request?: Record<string, unknown>) => Promise<unknown>,
  ) => mocks.handlers.set(channel, handler),
  registerHandlerWithSchema: (
    channel: string,
    schema: { safeParse: (request: unknown) => { success: boolean; data?: Record<string, unknown> } },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => mocks.handlers.set(channel, async (request) => {
    const parsed = schema.safeParse(request)
    if (!parsed.success) throw new Error(`Invalid IPC input for ${channel}`)
    return handler(parsed.data || {})
  }),
}))

vi.mock('../../worker-manager', () => ({
  workerManager: {
    isRunning: false,
    cwd: null,
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
  listAvailableModelsWithSdk: vi.fn(async () => []),
  listCatalogModelsWithSdk: vi.fn(async () => []),
  resolveAvailableModels: vi.fn(async () => []),
  resolveCatalogModels: vi.fn(async () => []),
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
    mocks.getSessionContextPreview.mockReset()
    mocks.getSessionContextPreviewFromDisk.mockReset()
    mocks.getSessionLeafOverride.mockReset()
    mocks.authorizeTrustedSessionFile.mockReset()
    mocks.isWslRuntimeActive.mockReset()
    mocks.isWslRuntimeActive.mockReturnValue(false)
    mocks.authorizeTrustedSessionFile.mockImplementation((_workspaceId, sessionFile) => ({
      ok: true,
      cwd: '/workspace',
      sessionFile,
    }))
    ;(workerManager as { isRunning: boolean }).isRunning = false
    registerModelRuntimeHandlers()
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
    expect(mocks.getSessionContextPreviewFromDisk).toHaveBeenCalledWith(
      sessionFile,
      'rewound-leaf',
    )
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
