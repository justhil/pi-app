import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cwd: '/workspace' as string | null,
  currentProject: null as string | null,
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
  configStore: { get: vi.fn(() => mocks.currentProject) },
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
    mocks.runtime = { mode: 'host', distro: null }
    mocks.readSessionMetaFromFile.mockReset()
    mocks.readSessionMetaFromFile.mockReturnValue({ sessionId: 'session-a', cwd: '/workspace' })
  })

  it('accepts an absolute session whose header belongs to the active workspace', () => {
    expect(authorizeTrustedSessionFile('/workspace', '/sessions/a.jsonl')).toEqual({
      ok: true,
      cwd: '/workspace',
      sessionFile: '/sessions/a.jsonl',
    })
  })

  it('rejects another workspace, a relative path, and a mismatched session header', () => {
    expect(authorizeTrustedSessionFile('/other', '/sessions/a.jsonl')).toEqual({
      ok: false,
      error: 'cwd_not_trusted',
    })
    expect(authorizeTrustedSessionFile('/workspace', 'session.jsonl')).toEqual({
      ok: false,
      error: 'invalid_session_path',
    })

    mocks.readSessionMetaFromFile.mockReturnValue({ sessionId: 'session-b', cwd: '/other' })
    expect(authorizeTrustedSessionFile('/workspace', '/sessions/b.jsonl')).toEqual({
      ok: false,
      error: 'session_workspace_mismatch',
    })
  })

  it('matches Windows workspace paths case-insensitively', () => {
    mocks.cwd = 'C:\\Project'
    mocks.readSessionMetaFromFile.mockReturnValue({ sessionId: 'session-a', cwd: 'c:\\project' })

    expect(authorizeTrustedSessionFile(mocks.cwd, 'C:\\sessions\\a.jsonl')).toEqual(
      expect.objectContaining({ ok: true }),
    )
  })

  it('rejects a WSL session from a distro other than the active runtime', () => {
    mocks.cwd = 'C:\\project'
    mocks.runtime = { mode: 'wsl', distro: 'Ubuntu' }
    mocks.readSessionMetaFromFile.mockReturnValue({ sessionId: 'session-a', cwd: '/mnt/c/project' })

    expect(
      authorizeTrustedSessionFile(
        mocks.cwd,
        '\\\\wsl.localhost\\Debian\\home\\u\\.pi\\agent\\sessions\\a.jsonl',
      ),
    ).toEqual({ ok: false, error: 'session_workspace_mismatch' })
  })

  it('matches native WSL header paths but rejects another session-file distro', () => {
    mocks.cwd = '\\\\wsl.localhost\\Ubuntu\\home\\u\\project'
    mocks.readSessionMetaFromFile.mockReturnValue({ sessionId: 'session-a', cwd: '/home/u/project' })

    expect(
      authorizeTrustedSessionFile(
        mocks.cwd,
        '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\sessions\\a.jsonl',
      ),
    ).toEqual(expect.objectContaining({ ok: true }))
    expect(
      authorizeTrustedSessionFile(
        mocks.cwd,
        '\\\\wsl.localhost\\Debian\\home\\u\\.pi\\agent\\sessions\\a.jsonl',
      ),
    ).toEqual({ ok: false, error: 'session_workspace_mismatch' })
  })
})
