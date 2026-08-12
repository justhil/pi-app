import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  authorizeTrustedSessionFile: vi.fn(),
  deleteSessionFile: vi.fn(),
  invalidateListSessions: vi.fn(),
  getTree: vi.fn(),
  getMessages: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
  registerHandlerWithSchema: (
    channel: string,
    schema: { safeParse: (value: unknown) => { success: boolean; data?: Record<string, unknown> } },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, async (request) => {
      const parsed = schema.safeParse(request)
      if (!parsed.success) throw new Error('invalid input')
      return handler(parsed.data!)
    })
  },
}))

vi.mock('../../trusted-workspace', () => ({
  authorizeTrustedSessionFile: mocks.authorizeTrustedSessionFile,
}))

vi.mock('../../session-preview-process', () => ({
  sessionPreviewProcess: {
    listSessions: vi.fn(async () => []),
    invalidateListSessions: mocks.invalidateListSessions,
    getTree: mocks.getTree,
    getMessages: mocks.getMessages,
  },
}))

vi.mock('../../worker-manager', () => ({
  workerManager: {
    cwd: '/workspace',
    isRunning: false,
    getState: mocks.getState,
    deleteSessionFile: mocks.deleteSessionFile,
    getSessionTree: vi.fn(),
  },
}))

vi.mock('../../config-store', () => ({
  configStore: { get: vi.fn(() => '/workspace') },
}))

vi.mock('../../session-leaf-override', () => ({
  getSessionLeafOverride: vi.fn(() => undefined),
  setSessionLeafOverride: vi.fn(),
}))

vi.mock('../../session-bind-state', () => ({
  ensureWorkerSessionBound: vi.fn(),
  getPendingWorkerSessionFile: vi.fn(),
  setPendingEphemeralSandboxDraft: vi.fn(),
  setPendingWorkerSessionFile: vi.fn(),
}))

vi.mock('../../session-prepare', () => ({ resolvePreparedSessionFile: vi.fn() }))
vi.mock('../../session-display-names', () => ({
  clearSessionDisplayName: vi.fn(),
  resolveSessionListTitle: vi.fn(),
}))
vi.mock('../../pi-rewind-read', () => ({ listRewindCheckpoints: vi.fn() }))
vi.mock('../../session-branch-anchors', () => ({ listMessageAnchorsFromSessionFile: vi.fn() }))
vi.mock('../../session-file-meta', () => ({ readSessionIdFromFile: vi.fn() }))
vi.mock('../../rename-pi-session', () => ({ renamePiSessionOnDisk: vi.fn() }))
vi.mock('../../sandbox-workspaces', () => ({
  bindSandboxSession: vi.fn(),
  isSandboxWorkspacePath: vi.fn(() => false),
  renameSandboxWorkspace: vi.fn(),
}))
vi.mock('../../session-fork-candidates', () => ({ listForkCandidatesFromSessionFile: vi.fn() }))

import { registerSessionHandlers } from './session'

describe('session preview authorization', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.authorizeTrustedSessionFile.mockReset()
    mocks.getTree.mockReset()
    mocks.getMessages.mockReset()
    mocks.getState.mockReset()
    mocks.deleteSessionFile.mockReset()
    mocks.deleteSessionFile.mockResolvedValue({ ok: true })
    mocks.invalidateListSessions.mockReset()
    mocks.invalidateListSessions.mockResolvedValue(undefined)
    registerSessionHandlers()
  })

  it.each([
    ['session_workspace_mismatch', '/other/session.jsonl'],
    ['session_workspace_mismatch', '\\\\wsl.localhost\\Debian\\home\\u\\session.jsonl'],
    ['invalid_session', '/sessions/forged-header.jsonl'],
  ])('rejects %s before preview reads', async (error, sessionFile) => {
    mocks.authorizeTrustedSessionFile.mockReturnValue({ ok: false, error })

    await expect(mocks.handlers.get('ipc:session.tree')!({ sessionFile, workspaceId: '/workspace' }))
      .resolves.toMatchObject({ nodes: [], error })
    await expect(mocks.handlers.get('ipc:session.getMessages')!({ sessionFile, workspaceId: '/workspace' }))
      .resolves.toMatchObject({ items: [], error })

    expect(mocks.getTree).not.toHaveBeenCalled()
    expect(mocks.getMessages).not.toHaveBeenCalled()
  })

  it('passes only the authorized path and cwd to Preview', async () => {
    mocks.authorizeTrustedSessionFile.mockReturnValue({
      ok: true,
      sessionFile: '/sessions/authorized.jsonl',
      cwd: '/workspace',
    })
    mocks.getTree.mockResolvedValue({ nodes: [], leafId: null })
    mocks.getMessages.mockResolvedValue({ items: [], totalCount: 0 })

    await mocks.handlers.get('ipc:session.tree')!({
      sessionFile: '/renderer/path.jsonl',
      workspaceId: '/workspace',
    })
    await mocks.handlers.get('ipc:session.getMessages')!({
      sessionFile: '/renderer/path.jsonl',
      workspaceId: '/workspace',
      offset: 0,
      limit: 80,
    })

    expect(mocks.getTree).toHaveBeenCalledWith(expect.objectContaining({
      sessionFile: '/sessions/authorized.jsonl',
      cwd: '/workspace',
    }))
    expect(mocks.getMessages).toHaveBeenCalledWith(expect.objectContaining({
      sessionFile: '/sessions/authorized.jsonl',
      cwd: '/workspace',
    }))
  })

  it('deletes and invalidates a background project using the renderer target workspace', async () => {
    mocks.authorizeTrustedSessionFile.mockReturnValue({
      ok: true,
      sessionFile: '/sessions/background.jsonl',
      cwd: '/background',
    })

    await expect(mocks.handlers.get('ipc:session.delete')!({
      sessionFile: '/renderer/background.jsonl',
      workspaceId: '/background',
    })).resolves.toEqual({ ok: true, error: undefined })

    expect(mocks.authorizeTrustedSessionFile).toHaveBeenCalledWith(
      '/background',
      '/renderer/background.jsonl',
    )
    expect(mocks.deleteSessionFile).toHaveBeenCalledWith('/sessions/background.jsonl')
    expect(mocks.invalidateListSessions).toHaveBeenCalledWith('/background')
  })

  it('rejects unknown keys through strict schemas', async () => {
    mocks.authorizeTrustedSessionFile.mockReturnValue({ ok: true, sessionFile: '/s.jsonl', cwd: '/workspace' })
    await expect(mocks.handlers.get('ipc:session.delete')!({
      sessionFile: '/s.jsonl',
      workspaceId: '/workspace',
      unexpected: true,
    })).rejects.toThrow('invalid input')
    await expect(mocks.handlers.get('ipc:session.tree')!({ sessionFile: '/s.jsonl', unexpected: true }))
      .rejects.toThrow('invalid input')
    await expect(mocks.handlers.get('ipc:session.getMessages')!({ sessionFile: '/s.jsonl', limit: 0 }))
      .rejects.toThrow('invalid input')
  })
})
