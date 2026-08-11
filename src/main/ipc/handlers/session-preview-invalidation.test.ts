import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  listSessions: vi.fn(),
  invalidateListSessions: vi.fn(),
  newSession: vi.fn(),
  forkSession: vi.fn(),
  cloneSession: vi.fn(),
  renamePiSessionOnDisk: vi.fn(),
  authorizeTrustedSessionFile: vi.fn((workspaceId: string, sessionFile: string) => ({
    ok: true,
    cwd: workspaceId,
    sessionFile,
  })),
  deleteSessionFile: vi.fn(),
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
}))

vi.mock('../../session-preview-process', () => ({
  sessionPreviewProcess: {
    listSessions: mocks.listSessions,
    invalidateListSessions: mocks.invalidateListSessions,
    getTree: vi.fn(),
    getMessages: vi.fn(),
  },
}))

vi.mock('../../worker-manager', () => ({
  workerManager: {
    cwd: '/workspace',
    isRunning: true,
    start: vi.fn(),
    newSession: mocks.newSession,
    forkSession: mocks.forkSession,
    cloneSession: mocks.cloneSession,
    deleteSessionFile: mocks.deleteSessionFile,
    getState: vi.fn(async () => ({})),
  },
}))

vi.mock('../../config-store', () => ({ configStore: { get: vi.fn(() => '/workspace'), set: vi.fn() } }))
vi.mock('../../session-bind-state', () => ({
  ensureWorkerSessionBound: vi.fn(),
  getPendingWorkerSessionFile: vi.fn(),
  setPendingEphemeralSandboxDraft: vi.fn(),
  setPendingWorkerSessionFile: vi.fn(),
}))
vi.mock('../../session-prepare', () => ({ resolvePreparedSessionFile: vi.fn() }))
vi.mock('../../session-display-names', () => ({
  clearSessionDisplayName: vi.fn(),
  resolveSessionListTitle: vi.fn((_file, fallback) => fallback),
  normalizeSessionFileKey: (f: string) => f,
}))
vi.mock('../../rename-pi-session', () => ({ renamePiSessionOnDisk: mocks.renamePiSessionOnDisk }))
vi.mock('../../sandbox-workspaces', () => ({
  bindSandboxSession: vi.fn(),
  isSandboxWorkspacePath: vi.fn(() => false),
  renameSandboxWorkspace: vi.fn(),
}))
vi.mock('../../pi-rewind-read', () => ({ listRewindCheckpoints: vi.fn() }))
vi.mock('../../session-branch-anchors', () => ({ listMessageAnchorsFromSessionFile: vi.fn() }))
vi.mock('../../session-file-meta', () => ({ readSessionIdFromFile: vi.fn() }))
vi.mock('../../session-leaf-override', () => ({
  getSessionLeafOverride: vi.fn(),
  setSessionLeafOverride: vi.fn(),
}))
vi.mock('../../session-fork-candidates', () => ({ listForkCandidatesFromSessionFile: vi.fn() }))
vi.mock('../../trusted-workspace', () => ({
  authorizeTrustedSessionFile: mocks.authorizeTrustedSessionFile,
}))

import { registerSessionHandlers } from './session'

describe('session list preview invalidation', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.listSessions.mockReset()
    mocks.listSessions
      .mockResolvedValueOnce([{ id: 'before', path: '/sessions/before.jsonl' }])
      .mockResolvedValue([{ id: 'after', path: '/sessions/after.jsonl' }])
    mocks.invalidateListSessions.mockReset()
    mocks.invalidateListSessions.mockResolvedValue(undefined)
    mocks.newSession.mockReset()
    mocks.newSession.mockResolvedValue({ sessionId: 'new', sessionFile: '/sessions/new.jsonl' })
    mocks.forkSession.mockReset()
    mocks.forkSession.mockResolvedValue({ sessionId: 'fork', sessionFile: '/sessions/fork.jsonl' })
    mocks.cloneSession.mockReset()
    mocks.cloneSession.mockResolvedValue({ sessionId: 'clone', sessionFile: '/sessions/clone.jsonl' })
    mocks.renamePiSessionOnDisk.mockReset()
    mocks.renamePiSessionOnDisk.mockResolvedValue({ ok: true })
    mocks.deleteSessionFile.mockReset()
    mocks.deleteSessionFile.mockResolvedValue({ ok: true })
    mocks.authorizeTrustedSessionFile.mockReset()
    mocks.authorizeTrustedSessionFile.mockImplementation((workspaceId: string, sessionFile: string) => ({
      ok: true,
      cwd: workspaceId,
      sessionFile,
    }))
    registerSessionHandlers()
  })

  it.each([
    ['ipc:session.new', { workspaceId: '/workspace' }],
    ['ipc:session.fork', { workspaceId: '/workspace', sessionFile: '/sessions/source.jsonl', entryId: 'entry' }],
    ['ipc:session.clone', { workspaceId: '/workspace', sessionFile: '/sessions/source.jsonl' }],
    ['ipc:session.rename', { workspaceId: '/workspace', sessionFile: '/sessions/source.jsonl', title: 'renamed' }],
    ['ipc:session.delete', { workspaceId: '/workspace', sessionFile: '/sessions/source.jsonl' }],
  ])('refreshes list immediately after successful %s', async (channel, request) => {
    const before = await mocks.handlers.get('ipc:session.list')!({ workspaceId: '/workspace' })
    await mocks.handlers.get(channel)!(request)
    const after = await mocks.handlers.get('ipc:session.list')!({ workspaceId: '/workspace' })

    expect(before).toMatchObject({ sessions: [{ sessionId: 'before' }] })
    expect(after).toMatchObject({ sessions: [{ sessionId: 'after' }] })
    expect(mocks.invalidateListSessions).toHaveBeenCalledWith('/workspace')
    expect(mocks.listSessions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invalidateListSessions.mock.invocationCallOrder[0],
    )
    expect(mocks.invalidateListSessions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listSessions.mock.invocationCallOrder[1],
    )
  })
})
