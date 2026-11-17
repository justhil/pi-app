import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { uniqueWorkspacePaths, workspacePathsEqual } from '@shared/workspace-path'
import { nextRecentProjects, workspaceRealPathsEqual } from '../../recent-projects'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  state: {
    recentProjects: [] as string[],
    recentProjectsFixedOrder: false,
    currentProject: null as string | null,
    hiddenWorktrees: [] as string[],
  },
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

vi.mock('../../config-store', () => ({
  configStore: {
    get: (key: string) => (mocks.state as Record<string, unknown>)[key],
    set: (key: string, value: unknown) => {
      ;(mocks.state as Record<string, unknown>)[key] = value
    },
    addRecentProject: (path: string) => {
      mocks.state.recentProjects = nextRecentProjects(
        mocks.state.recentProjects,
        path,
        mocks.state.recentProjectsFixedOrder,
      )
      mocks.state.hiddenWorktrees = mocks.state.hiddenWorktrees.filter((p) => !workspacePathsEqual(p, path))
    },
    removeRecentProject: (path: string) => {
      mocks.state.recentProjects = mocks.state.recentProjects.filter((p) => !workspaceRealPathsEqual(p, path))
    },
    hideWorktree: (path: string) => {
      if (!mocks.state.hiddenWorktrees.some((p) => workspacePathsEqual(p, path))) {
        mocks.state.hiddenWorktrees = uniqueWorkspacePaths([...mocks.state.hiddenWorktrees, path])
      }
    },
    setProjectDisplayName: vi.fn(),
  },
}))

vi.mock('../../worker-manager', () => ({
  workerManager: {
    get cwd() {
      return mocks.state.currentProject
    },
    isRunning: false,
    start: vi.fn(async () => ({ sessionId: 's1', model: 'm' })),
    getState: vi.fn(async () => ({})),
    deleteSessionFile: vi.fn(async () => ({ ok: true })),
    getSessionTree: vi.fn(),
  },
}))

vi.mock('../../sqlite-index', () => ({ sqliteIndex: { upsertWorkspace: vi.fn() } }))
vi.mock('../../window', () => ({ getMainWindow: vi.fn(() => null) }))
vi.mock('../../git-workspace-watch', () => ({ refreshGitWorkspaceWatch: vi.fn(async () => {}) }))
vi.mock('../../remote-project-registry', () => ({ invalidateKnownRemoteProjects: vi.fn() }))
vi.mock('../../remote/tap', () => ({ remoteTap: { settingsChanged: vi.fn() } }))
vi.mock('../../agent-purge-service', () => ({ inheritPurgedSession: vi.fn(), removePurgedSession: vi.fn() }))
vi.mock('../../completion-notification-events', () => ({ setVisibleSessionFile: vi.fn() }))
vi.mock('../../prompt-abort-epoch', () => ({ bumpPromptAbortEpoch: vi.fn() }))
vi.mock('../../wsl/wsl-env', () => ({ awaitWslVm: vi.fn(async () => {}) }))
vi.mock('../../wsl/runtime-config', () => ({ getAgentRuntimeConfig: vi.fn(() => ({ mode: 'host', distro: null })) }))
vi.mock('../../session-preview-process', () => ({
  sessionPreviewProcess: { listSessions: vi.fn(async () => []), invalidateListSessions: vi.fn() },
}))
vi.mock('../../session-leaf-override', () => ({ getSessionLeafOverride: vi.fn(), setSessionLeafOverride: vi.fn() }))
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
vi.mock('../../session-fork-candidates', () => ({ listForkCandidatesFromSessionFile: vi.fn() }))
vi.mock('../../trusted-workspace', () => ({ authorizeTrustedSessionFile: vi.fn() }))
vi.mock('../../sandbox-workspaces', () => ({
  bindSandboxSession: vi.fn(),
  bindSandboxSessionAsync: vi.fn(),
  createSandboxWorkspace: vi.fn(),
  deleteSandboxWorkspace: vi.fn(() => true),
  isSandboxWorkspacePath: (p: string) => p.replace(/\\/g, '/').includes('sandbox-workspaces/'),
  listSandboxWorkspaces: vi.fn(async () => []),
  renameSandboxWorkspace: vi.fn(),
}))

import { registerSessionHandlers } from './session'
import { registerWorkspaceHandlers } from './workspace'

const tempRoots: string[] = []

describe('project.removeRecent & workspace.open persistence', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.state.recentProjects = []
    mocks.state.recentProjectsFixedOrder = false
    mocks.state.currentProject = null
    mocks.state.hiddenWorktrees = []
    registerSessionHandlers()
    registerWorkspaceHandlers()
  })

  afterEach(() => {
    for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('removes a Windows backslash entry when sidebar submits Git forward-slash path (#143)', async () => {
    mocks.state.recentProjects = ['D:\\Projects\\A', 'D:\\Projects\\B']
    mocks.state.currentProject = 'D:\\Projects\\A'

    const res = await mocks.handlers.get('ipc:project.removeRecent')!({ path: 'D:/Projects/B' })
    expect(res).toEqual({
      ok: true,
      currentProject: 'D:\\Projects\\A',
      recentProjects: ['D:\\Projects\\A'],
    })
    expect(mocks.state.recentProjects).toEqual(['D:\\Projects\\A'])
    expect(mocks.state.hiddenWorktrees).toEqual([])
  })

  it('removes a symlink / Windows junction project entry when given the canonical Git path (#143)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-remove-link-'))
    tempRoots.push(root)
    const dirA = join(root, 'A')
    const realB = join(root, 'real-B')
    const linkB = join(root, 'link-B')
    mkdirSync(dirA, { recursive: true })
    mkdirSync(realB, { recursive: true })
    symlinkSync(realB, linkB, process.platform === 'win32' ? 'junction' : 'dir')

    mocks.state.recentProjects = [dirA, linkB]
    mocks.state.currentProject = dirA

    const res = await mocks.handlers.get('ipc:project.removeRecent')!({ path: realB.replace(/\\/g, '/') })
    expect(res).toEqual({
      ok: true,
      currentProject: dirA,
      recentProjects: [dirA],
    })
    expect(mocks.state.recentProjects).toEqual([dirA])
    expect(mocks.state.hiddenWorktrees).toEqual([])
  })

  it('replaces a removed worktree with its sibling in place and hides only the checkout', async () => {
    mocks.state.recentProjectsFixedOrder = true
    mocks.state.recentProjects = ['D:\\p1', 'D:\\repo-main', 'D:\\p3']
    mocks.state.currentProject = 'D:\\repo-main'

    const res = await mocks.handlers.get('ipc:project.removeRecent')!({
      path: 'D:/repo-main',
      siblingPaths: ['D:/repo-wt2'],
    })
    expect(res).toEqual({
      ok: true,
      currentProject: 'D:/repo-wt2',
      recentProjects: ['D:\\p1', 'D:/repo-wt2', 'D:\\p3'],
    })
    expect(mocks.state.hiddenWorktrees).toEqual(['D:/repo-main'])
  })

  it('removes an entire repository group without polluting hiddenWorktrees', async () => {
    mocks.state.recentProjects = ['D:\\p1', 'D:\\repo-main', 'D:\\repo-wt2', 'D:\\p3']
    mocks.state.currentProject = 'D:\\p1'

    const res = await mocks.handlers.get('ipc:project.removeRecent')!({
      path: 'D:/repo-main',
      isRepositoryGroup: true,
      groupPaths: ['D:/repo-main', 'D:/repo-wt2'],
    })
    expect(res).toEqual({
      ok: true,
      currentProject: 'D:\\p1',
      recentProjects: ['D:\\p1', 'D:\\p3'],
    })
    expect(mocks.state.hiddenWorktrees).toEqual([])
  })

  it('does not let sandbox temp chats enter or evict real projects (#141)', async () => {
    const open = mocks.handlers.get('ipc:workspace.open')!
    for (let i = 1; i <= 15; i++) {
      await open({ path: `D:/projects/proj-${i}`, awaitWorker: false })
    }
    for (let i = 1; i <= 15; i++) {
      await open({ path: `C:/Users/me/AppData/Roaming/pi-desktop/sandbox-workspaces/sb-${i}`, awaitWorker: false })
    }

    expect(mocks.state.recentProjects).toHaveLength(15)
    expect(mocks.state.recentProjects.every((p) => !p.includes('sandbox-workspaces'))).toBe(true)
    expect(mocks.state.currentProject).toBe('C:/Users/me/AppData/Roaming/pi-desktop/sandbox-workspaces/sb-15')
  })
})
