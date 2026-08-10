import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWslSync: vi.fn<
    (args: string[], opts?: { timeout?: number; input?: string }) => {
      status: number
      stdout: string
      stderr: string
    }
  >(),
}))

vi.mock('../wsl/wsl-exec', () => ({
  runWslSync: mocks.runWslSync,
  isValidWslDistroName: (d: string | null | undefined) =>
    typeof d === 'string' && d.trim() !== '' && /^[A-Za-z0-9._-]+$/.test(d),
  WSL_DISTRO_PATTERN: /^[A-Za-z0-9._-]+$/,
}))

import { runGitInWsl } from '../wsl/git-delegate'

describe('runGitInWsl', () => {
  beforeEach(() => {
    mocks.runWslSync.mockReset()
    mocks.runWslSync.mockReturnValue({ status: 0, stdout: 'ok', stderr: '' })
  })

  it('translates a Windows drive path to /mnt/<drive> and runs git in the distro', () => {
    const result = runGitInWsl('Ubuntu', 'C:\\project', ['status', '--porcelain', '-b'], {
      timeout: 5000,
    })
    expect(result).toEqual({ status: 0, stdout: 'ok', stderr: '' })
    expect(mocks.runWslSync).toHaveBeenCalledTimes(1)
    expect(mocks.runWslSync).toHaveBeenCalledWith(
      ['-d', 'Ubuntu', '--cd', '/mnt/c/project', '--', 'git', 'status', '--porcelain', '-b'],
      { timeout: 5000, input: undefined },
    )
  })

  it('translates a WSL UNC path to its native form', () => {
    runGitInWsl('Ubuntu', '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj', ['diff'])
    expect(mocks.runWslSync).toHaveBeenCalledWith(
      ['-d', 'Ubuntu', '--cd', '/home/u/proj', '--', 'git', 'diff'],
      expect.anything(),
    )
  })

  it('forwards input (stdin) for apply/commit style commands', () => {
    runGitInWsl('Ubuntu', 'D:\\repo', ['apply', '--cached', '--recount'], { input: 'patch' })
    expect(mocks.runWslSync).toHaveBeenCalledWith(
      ['-d', 'Ubuntu', '--cd', '/mnt/d/repo', '--', 'git', 'apply', '--cached', '--recount'],
      { timeout: undefined, input: 'patch' },
    )
  })

  it('rejects an invalid distro without spawning', () => {
    const result = runGitInWsl('bad;distro', 'C:\\x', ['status'])
    expect(result.status).toBe(-1)
    expect(result.stderr).toContain('invalid wsl distro')
    expect(mocks.runWslSync).not.toHaveBeenCalled()
  })
})
