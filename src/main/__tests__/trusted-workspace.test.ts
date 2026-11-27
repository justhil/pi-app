import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const sandboxRoot = join(tmpdir(), `pi-trusted-workspace-${process.pid}`)

const mocks = vi.hoisted(() => ({
  cwd: '/workspace' as string | null,
  currentProject: null as string | null,
  recentProjects: [] as string[],
  sandboxPath: '' as string,
  runtime: { mode: 'host' as 'host' | 'wsl', distro: null as string | null },
  readSessionMetaFromFile: vi.fn(),
  liveRuntime: [] as Array<{ sessionFile: string; running: boolean; cwd: string }>,
}))

vi.mock('../worker-manager', () => ({
  workerManager: {
    get cwd() {
      return mocks.cwd
    },
    listSessionRuntime: () => mocks.liveRuntime,
  },
}))

vi.mock('../config-store', () => ({
  configStore: {
    get: vi.fn((key: string) => key === 'currentProject' ? mocks.currentProject : mocks.recentProjects),
  },
}))

vi.mock('../sandbox-workspaces', () => ({
  isSandboxWorkspacePath: vi.fn((path: string) => path === mocks.sandboxPath),
}))

vi.mock('../wsl/runtime-config', () => ({
  getAgentRuntimeConfig: () => mocks.runtime,
}))

vi.mock('../session-file-meta', () => ({
  readSessionMetaFromFile: mocks.readSessionMetaFromFile,
}))

import { authorizeProjectCwd, authorizeTrustedCwd, authorizeTrustedSessionFile, getTrustedWorkspaceRoot } from '../trusted-workspace'

describe('trusted workspace authorization', () => {
  beforeEach(() => {
    mocks.cwd = '/workspace'
    mocks.currentProject = null
    mocks.recentProjects = []
    mocks.sandboxPath = join(sandboxRoot, 'managed')
    mkdirSync(mocks.sandboxPath, { recursive: true })
    mocks.runtime = { mode: 'host', distro: null }
    mocks.liveRuntime = []
    mocks.readSessionMetaFromFile.mockReset()
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-a', cwd: '/workspace' })
  })

  afterEach(() => rmSync(sandboxRoot, { recursive: true, force: true }))

  it('normalizes WSL worker cwd and both native and host requests before authorizing Git access', () => {
    mocks.runtime = { mode: 'wsl', distro: 'Debian' }
    mocks.cwd = '/home/u/project'
    const cwd = '\\\\wsl.localhost\\Debian\\home\\u\\project'
    mocks.currentProject = cwd

    expect(getTrustedWorkspaceRoot()).toBe(cwd)
    expect(authorizeTrustedCwd(undefined)).toEqual({ ok: true, cwd })
    expect(authorizeTrustedCwd('/home/u/project')).toEqual({ ok: true, cwd })
    expect(authorizeTrustedCwd(cwd)).toEqual({ ok: true, cwd })
    expect(authorizeProjectCwd(cwd)).toEqual({ ok: true, cwd })
    expect(authorizeProjectCwd('/home/u/project')).toEqual({ ok: true, cwd })
    expect(authorizeTrustedCwd('/home/u/other')).toEqual({ ok: false, error: 'cwd_not_trusted' })
    expect(authorizeProjectCwd('\\\\wsl.localhost\\Ubuntu\\home\\u\\project')).toEqual({ ok: false, error: 'cwd_not_trusted' })
  })

  it('normalizes persisted current and recent WSL workspaces without authorizing unrelated paths', () => {
    mocks.runtime = { mode: 'wsl', distro: 'Debian' }
    mocks.cwd = null
    mocks.currentProject = '/home/u/project'
    mocks.recentProjects = ['/mnt/c/background']

    expect(getTrustedWorkspaceRoot()).toBe('\\\\wsl.localhost\\Debian\\home\\u\\project')
    expect(authorizeProjectCwd('/mnt/c/background')).toEqual({ ok: true, cwd: 'C:\\background' })
    expect(authorizeProjectCwd('C:\\background')).toEqual({ ok: true, cwd: 'C:\\background' })
    expect(authorizeProjectCwd('/home/u/other')).toEqual({ ok: false, error: 'cwd_not_trusted' })
  })

  it('keeps native workspace paths when using the host runtime', () => {
    mocks.cwd = '/home/u/project'
    expect(getTrustedWorkspaceRoot()).toBe(mocks.cwd)
    expect(authorizeTrustedCwd(mocks.cwd)).toEqual({ ok: true, cwd: mocks.cwd })
  })

  it('accepts an absolute session whose header belongs to the active workspace', async () => {
    expect(await authorizeTrustedSessionFile('/workspace', '/sessions/a.jsonl')).toEqual({
      ok: true,
      cwd: '/workspace',
      sessionFile: '/sessions/a.jsonl',
    })
  })

  it('rejects another workspace, a relative path, and a mismatched session header', async () => {
    expect(await authorizeTrustedSessionFile('/other', '/sessions/a.jsonl')).toEqual({
      ok: false,
      error: 'cwd_not_trusted',
    })
    expect(await authorizeTrustedSessionFile('/workspace', 'session.jsonl')).toEqual({
      ok: false,
      error: 'invalid_session_path',
    })

    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-b', cwd: '/other' })
    expect(await authorizeTrustedSessionFile('/workspace', '/sessions/b.jsonl')).toEqual({
      ok: false,
      error: 'session_workspace_mismatch',
    })
  })

  it('accepts a persisted recent project and a managed sandbox but rejects arbitrary renderer cwd', async () => {
    mocks.recentProjects = ['/background']
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-b', cwd: '/background' })
    expect(await authorizeTrustedSessionFile('/background', '/sessions/background.jsonl')).toEqual({
      ok: true,
      cwd: '/background',
      sessionFile: '/sessions/background.jsonl',
    })

    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-s', cwd: mocks.sandboxPath })
    expect(await authorizeTrustedSessionFile(mocks.sandboxPath, '/sessions/sandbox.jsonl')).toEqual(
      expect.objectContaining({ ok: true, cwd: mocks.sandboxPath }),
    )

    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-e', cwd: '/evil' })
    expect(await authorizeTrustedSessionFile('/evil', '/sessions/evil.jsonl')).toEqual({
      ok: false,
      error: 'cwd_not_trusted',
    })
  })

  it('matches Windows workspace paths case-insensitively', async () => {
    mocks.cwd = 'C:\\Project'
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-a', cwd: 'c:\\project' })

    expect(await authorizeTrustedSessionFile(mocks.cwd, 'C:\\sessions\\a.jsonl')).toEqual(
      expect.objectContaining({ ok: true }),
    )
  })

  it('authorizes WSL session headers against their Windows workspace view', async () => {
    mocks.cwd = 'C:\\project'
    mocks.runtime = { mode: 'wsl', distro: 'Ubuntu' }
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-a', cwd: '/mnt/c/project' })

    expect(
      await authorizeTrustedSessionFile(
        mocks.cwd,
        '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\sessions\\a.jsonl',
      ),
    ).toEqual(expect.objectContaining({ ok: true, cwd: mocks.cwd }))
  })

  it('rejects a WSL session from a distro other than the active runtime', async () => {
    mocks.cwd = 'C:\\project'
    mocks.runtime = { mode: 'wsl', distro: 'Ubuntu' }
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-a', cwd: '/mnt/c/project' })

    expect(
      await authorizeTrustedSessionFile(
        mocks.cwd,
        '\\\\wsl.localhost\\Debian\\home\\u\\.pi\\agent\\sessions\\a.jsonl',
      ),
    ).toEqual({ ok: false, error: 'session_workspace_mismatch' })
  })

  it('matches native WSL header paths but rejects another session-file distro', async () => {
    mocks.cwd = '\\\\wsl.localhost\\Ubuntu\\home\\u\\project'
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-a', cwd: '/home/u/project' })

    expect(
      await authorizeTrustedSessionFile(
        mocks.cwd,
        '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\sessions\\a.jsonl',
      ),
    ).toEqual(expect.objectContaining({ ok: true }))
    expect(
      await authorizeTrustedSessionFile(
        mocks.cwd,
        '\\\\wsl.localhost\\Debian\\home\\u\\.pi\\agent\\sessions\\a.jsonl',
      ),
    ).toEqual({ ok: false, error: 'session_workspace_mismatch' })
  })

  it('should_authorize_newly_created_unflushed_session_bound_to_live_worker_while_still_rejecting_unknown_unflushed_path', async () => {
    mocks.readSessionMetaFromFile.mockResolvedValue(null)
    mocks.liveRuntime = [{ sessionFile: '/sessions/new-unflushed.jsonl', running: false, cwd: '/workspace' }]

    expect(await authorizeTrustedSessionFile('/workspace', '/sessions/new-unflushed.jsonl')).toEqual({
      ok: true,
      cwd: '/workspace',
      sessionFile: '/sessions/new-unflushed.jsonl',
    })

    expect(await authorizeTrustedSessionFile('/workspace', '/sessions/forged-missing.jsonl')).toEqual({
      ok: false,
      error: 'invalid_session',
    })
  })
})
