import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `pi-session-edit-auth-${process.pid}`)
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
  editSessionMessageOnLiveWorker: vi.fn(),
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
    deleteSessionFile: vi.fn(),
    editSessionMessageOnLiveWorker: mocks.editSessionMessageOnLiveWorker,
    getSessionTree: vi.fn(),
  },
}))

vi.mock('../../config-store', () => ({
  configStore: {
    get: vi.fn((key: string) =>
      key === 'currentProject' ? mocks.currentProject : key === 'recentProjects' ? mocks.recentProjects : undefined,
    ),
    set: vi.fn(),
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

function writeSampleSession(path: string, cwd: string): void {
  const lines = [
    JSON.stringify({ type: 'session', version: 3, id: 'sid-1', cwd }),
    JSON.stringify({
      type: 'message',
      id: 'entry-u1',
      parentId: null,
      timestamp: '2026-11-18T00:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 },
    }),
    JSON.stringify({
      type: 'message',
      id: 'entry-a1',
      parentId: 'entry-u1',
      timestamp: '2026-11-18T00:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'refusal text' }], stopReason: 'stop', timestamp: 2 },
    }),
  ]
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
}

describe('ipc:session.editMessage integration', () => {
  beforeEach(() => {
    mkdirSync(root, { recursive: true })
    for (const workspace of [foreground, background, evil]) mkdirSync(workspace, { recursive: true })
    writeSampleSession(foregroundSession, foreground)
    writeSampleSession(backgroundSession, background)
    writeSampleSession(evilSession, evil)
    mocks.currentProject = foreground
    mocks.recentProjects = [background]
    mocks.handlers.clear()
    mocks.editSessionMessageOnLiveWorker.mockReset()
    mocks.editSessionMessageOnLiveWorker.mockResolvedValue(null)
    mocks.invalidateListSessions.mockReset()
    mocks.invalidateListSessions.mockResolvedValue(undefined)
    registerSessionHandlers()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('rewrites assistant message in place on offline trusted session file and invalidates preview list', async () => {
    const res = await mocks.handlers.get('ipc:session.editMessage')!({
      workspaceId: foreground,
      sessionFile: foregroundSession,
      entryId: 'entry-a1',
      text: 'forged compliant reply',
    })
    expect(res).toEqual({ ok: true, role: 'assistant' })
    expect(mocks.invalidateListSessions).toHaveBeenCalledWith(foreground)
    const raw = readFileSync(foregroundSession, 'utf8')
    expect(raw).toContain('forged compliant reply')
    expect(raw).not.toContain('refusal text')
  })

  it('rejects SESSION_BUSY when live worker owns an active turn', async () => {
    mocks.editSessionMessageOnLiveWorker.mockResolvedValue({ ok: false, error: 'SESSION_BUSY' })
    const res = await mocks.handlers.get('ipc:session.editMessage')!({
      workspaceId: background,
      sessionFile: backgroundSession,
      entryId: 'entry-u1',
      text: 'edited prompt',
    })
    expect(res).toEqual({ ok: false, error: 'SESSION_BUSY' })
    expect(mocks.invalidateListSessions).not.toHaveBeenCalled()
    expect(readFileSync(backgroundSession, 'utf8')).toContain('hello')
  })

  it('rejects untrusted workspace session file without touching disk', async () => {
    const res = await mocks.handlers.get('ipc:session.editMessage')!({
      workspaceId: evil,
      sessionFile: evilSession,
      entryId: 'entry-a1',
      text: 'tampered',
    })
    expect(res).toEqual({ ok: false, error: 'cwd_not_trusted' })
    expect(readFileSync(evilSession, 'utf8')).toContain('refusal text')
  })
})
