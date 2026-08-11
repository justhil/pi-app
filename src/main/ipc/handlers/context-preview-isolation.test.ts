import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request?: Record<string, unknown>) => Promise<unknown>>(),
  getSessionContextPreview: vi.fn(),
  sessionOpen: vi.fn(),
  getSessionLeafOverride: vi.fn(),
  authorizeTrustedSessionFile: vi.fn(),
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

vi.mock('../../trusted-workspace', () => ({
  authorizeTrustedSessionFile: mocks.authorizeTrustedSessionFile,
}))

vi.mock('../sdk-session', () => ({
  getActiveSdkModule: vi.fn(async () => ({
    SessionManager: { open: mocks.sessionOpen },
  })),
}))

import { workerManager } from '../../worker-manager'
import { registerModelRuntimeHandlers } from './model-runtime'

describe('context.preview session isolation', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.getSessionContextPreview.mockReset()
    mocks.sessionOpen.mockReset()
    mocks.getSessionLeafOverride.mockReset()
    mocks.authorizeTrustedSessionFile.mockReset()
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
    expect(mocks.authorizeTrustedSessionFile).not.toHaveBeenCalled()
    expect(result).toEqual({
      preview: expect.objectContaining({ sessionFile, estimatedChars: 22 }),
    })
  })

  it('reads an idle session from disk without requiring a running worker', async () => {
    const sessionFile = '/sessions/idle.jsonl'
    mocks.getSessionContextPreview.mockResolvedValue(null)
    mocks.getSessionLeafOverride.mockReturnValue('rewound-leaf')
    const branch = vi.fn()
    mocks.sessionOpen.mockReturnValue({
      branch,
      resetLeaf: vi.fn(),
      getSessionId: () => 'idle-session',
      buildSessionContext: () => ({
        messages: [{ role: 'user', content: 'idle context' }],
      }),
    })

    const result = await mocks.handlers.get('ipc:context.preview')!({
      sessionFile,
      workspaceId: '/workspace',
    })

    expect(mocks.authorizeTrustedSessionFile).toHaveBeenCalledWith('/workspace', sessionFile)
    expect(branch).toHaveBeenCalledWith('rewound-leaf')
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
    expect(mocks.sessionOpen).not.toHaveBeenCalled()
  })
})
