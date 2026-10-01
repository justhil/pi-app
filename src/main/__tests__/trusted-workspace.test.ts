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
}))

vi.mock('../worker-manager', () => ({
  workerManager: {
    get cwd() {
      return mocks.cwd
    },
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

import { authorizeTrustedSessionFile } from '../trusted-workspace'

describe('authorizeTrustedSessionFile', () => {
  beforeEach(() => {
    mocks.cwd = '/workspace'
    mocks.currentProject = null
    mocks.recentProjects = []
    mocks.sandboxPath = join(sandboxRoot, 'managed')
    mkdirSync(mocks.sandboxPath, { recursive: true })
    mocks.runtime = { mode: 'host', distro: null }
    mocks.readSessionMetaFromFile.mockReset()
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'session-a', cwd: '/workspace' })
  })

  afterEach(() => rmSync(sandboxRoot, { recursive: true, force: true }))

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
})
