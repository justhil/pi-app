import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `pi-session-delete-auth-${process.pid}`)
const foreground = join(root, 'foreground')
const background = join(root, 'background')
const evil = join(root, 'evil')
const foregroundSession = join(root, 'foreground.jsonl')
const backgroundSession = join(root, 'background.jsonl')
const evilSession = join(root, 'evil.jsonl')

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  currentProject: '',
  recentProjects: [] as string[],
  deleteSessionFile: vi.fn(),
  invalidateListSessions: vi.fn(),
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

vi.mock('../../worker-manager', () => ({
  workerManager: {
    get cwd() {
      return mocks.currentProject
    },
    isRunning: false,
    getState: vi.fn(async () => ({})),
    deleteSessionFile: mocks.deleteSessionFile,
    getSessionTree: vi.fn(),
  },
}))

vi.mock('../../config-store', () => ({
  configStore: {
    get: vi.fn((key: string) => key === 'currentProject' ? mocks.currentProject : key === 'recentProjects' ? mocks.recentProjects : undefined),
  },
}))

vi.mock('../../session-preview-process', () => ({
  sessionPreviewProcess: {
    listSessions: vi.fn(async () => []),
    invalidateListSessions: mocks.invalidateListSessions,
    getTree: vi.fn(),
    getMessages: vi.fn(),
  },
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
vi.mock('../../session-display-names', () => ({ clearSessionDisplayName: vi.fn(), resolveSessionListTitle: vi.fn() }))
vi.mock('../../pi-rewind-read', () => ({ listRewindCheckpoints: vi.fn() }))
vi.mock('../../session-branch-anchors', () => ({ listMessageAnchorsFromSessionFile: vi.fn() }))
vi.mock('../../rename-pi-session', () => ({ renamePiSessionOnDisk: vi.fn() }))
vi.mock('../../sandbox-workspaces', () => ({
  bindSandboxSession: vi.fn(),
  isSandboxWorkspacePath: vi.fn(() => false),
  renameSandboxWorkspace: vi.fn(),
}))
vi.mock('../../session-fork-candidates', () => ({ listForkCandidatesFromSessionFile: vi.fn() }))

import { registerSessionHandlers } from './session'

function writeSession(path: string, cwd: string): void {
  writeFileSync(path, `${JSON.stringify({ type: 'session', id: path, cwd })}\n`, 'utf8')
}

describe('session delete trusted workspace integration', () => {
  beforeEach(() => {
    mkdirSync(root, { recursive: true })
    for (const workspace of [foreground, background, evil]) mkdirSync(workspace, { recursive: true })
    writeSession(foregroundSession, foreground)
    writeSession(backgroundSession, background)
    writeSession(evilSession, evil)
    mocks.currentProject = foreground
    mocks.recentProjects = [background]
    mocks.handlers.clear()
    mocks.deleteSessionFile.mockReset()
    mocks.deleteSessionFile.mockResolvedValue({ ok: true })
    mocks.invalidateListSessions.mockReset()
    mocks.invalidateListSessions.mockResolvedValue(undefined)
    registerSessionHandlers()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it.each([
    ['foreground', foreground, foregroundSession],
    ['persisted recent background', background, backgroundSession],
  ])('deletes a %s session through real trusted authorization', async (_label, workspaceId, sessionFile) => {
    await expect(mocks.handlers.get('ipc:session.delete')!({ workspaceId, sessionFile }))
      .resolves.toEqual({ ok: true, error: undefined })
    expect(mocks.deleteSessionFile).toHaveBeenCalledWith(sessionFile)
    expect(mocks.invalidateListSessions).toHaveBeenCalledWith(workspaceId)
  })

  it('rejects an arbitrary renderer workspace even when the session header matches it', async () => {
    await expect(mocks.handlers.get('ipc:session.delete')!({ workspaceId: evil, sessionFile: evilSession }))
      .resolves.toEqual({ ok: false, error: 'cwd_not_trusted' })
    expect(mocks.deleteSessionFile).not.toHaveBeenCalled()
    expect(mocks.invalidateListSessions).not.toHaveBeenCalled()
  })
})
