import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: Record<string, unknown>) => Promise<unknown>>(),
  authorizeProjectCwd: vi.fn(),
  getTrustedWorkspaceRoot: vi.fn(),
  readGitWorkspaceSnapshot: vi.fn(),
  stageHunks: vi.fn(),
  unstageHunks: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, fn: (req: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, fn)
  },
  registerHandlerWithSchema: (
    channel: string,
    _schema: unknown,
    fn: (req: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, fn)
  },
}))
vi.mock('../../trusted-workspace', () => ({
  authorizeProjectCwd: (...args: unknown[]) => mocks.authorizeProjectCwd(...args),
  getTrustedWorkspaceRoot: () => mocks.getTrustedWorkspaceRoot(),
}))
vi.mock('../../git-workspace', () => ({
  readGitWorkspaceSnapshot: (...args: unknown[]) => mocks.readGitWorkspaceSnapshot(...args),
  stageHunks: (...args: unknown[]) => mocks.stageHunks(...args),
  unstageHunks: (...args: unknown[]) => mocks.unstageHunks(...args),
}))

import { registerReviewHandlers } from './review'

describe('review.getDiff workspace authorization', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.authorizeProjectCwd.mockReset()
    mocks.getTrustedWorkspaceRoot.mockReset()
    mocks.readGitWorkspaceSnapshot.mockReset()
    registerReviewHandlers()
  })

  it('should_read_git_snapshot_from_requested_cwd_instead_of_stale_worker_cwd_when_switching_via_active_session_popover', async () => {
    mocks.getTrustedWorkspaceRoot.mockReturnValue('D:\\workspace\\old-non-git-project')
    mocks.authorizeProjectCwd.mockReturnValue({ ok: true, cwd: 'D:\\workspace\\active-git-repo' })
    mocks.readGitWorkspaceSnapshot.mockResolvedValue({
      isRepo: true,
      branch: 'main',
      status: ' M src/index.ts\n',
      raw: 'diff --git a/src/index.ts b/src/index.ts\n',
      stagedRaw: '',
      log: '',
    })

    const handler = mocks.handlers.get('ipc:review.getDiff')!
    const res = await handler({
      sessionId: 's-active',
      scope: 'git',
      cwd: 'D:\\workspace\\active-git-repo',
    })

    expect(mocks.authorizeProjectCwd).toHaveBeenCalledWith('D:\\workspace\\active-git-repo')
    expect(mocks.readGitWorkspaceSnapshot).toHaveBeenCalledWith('D:\\workspace\\active-git-repo')
    expect(res).toMatchObject({
      diff: {
        isRepo: true,
        branch: 'main',
        status: ' M src/index.ts\n',
      },
    })
  })

  it('should_reject_untrusted_cwd_in_review_getDiff', async () => {
    mocks.authorizeProjectCwd.mockReturnValue({ ok: false, error: 'untrusted_workspace' })

    const handler = mocks.handlers.get('ipc:review.getDiff')!
    const res = await handler({
      sessionId: 's-1',
      scope: 'git',
      cwd: 'C:\\Windows\\System32',
    })

    expect(mocks.readGitWorkspaceSnapshot).not.toHaveBeenCalled()
    expect(res).toMatchObject({
      diff: {
        isRepo: false,
        message: 'untrusted_workspace',
      },
    })
  })
})
