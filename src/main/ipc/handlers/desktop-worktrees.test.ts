import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (req: Record<string, unknown>) => Promise<unknown>>(),
  runGit: vi.fn(),
  execFileSync: vi.fn(() => 'worktree /repo/A\nHEAD a\nbranch refs/heads/main\n\nworktree /gone\nHEAD b\nprunable missing\n\n'),
}))
vi.mock('../registry', () => ({
  registerHandler: (name: string, handler: (req: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, handler),
  registerHandlerWithSchema: (name: string, schema: { parse: (req: unknown) => Record<string, unknown> }, handler: (req: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, (req) => handler(schema.parse(req))),
}))
vi.mock('electron', () => ({ app: {}, powerSaveBlocker: {}, dialog: {} }))
vi.mock('child_process', () => ({ default: { execFileSync: mocks.execFileSync }, execFileSync: mocks.execFileSync }))
vi.mock('../../worker-manager', () => ({ workerManager: { cwd: '/repo/A' } }))
vi.mock('../../trusted-workspace', () => ({ getTrustedWorkspaceRoot: () => '/repo/A' }))
vi.mock('../../config-store', () => ({ configStore: { get: (key: string) => key === 'recentProjects' ? ['/repo/A', '/repo/B'] : '/repo/B' } }))
vi.mock('../../completion-notification', () => ({ listCompletionInbox: vi.fn(), markCompletionInboxRead: vi.fn(), markCompletionInboxUnread: vi.fn() }))
vi.mock('../../git-workspace', () => ({ runGitReadOnly: mocks.runGit }))
vi.mock('fs/promises', () => {
  const stat = vi.fn(async (path: string) => ({ isDirectory: () => path !== '/gone' }))
  return { default: { stat }, stat }
})
vi.mock('../../wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => ({ mode: 'host' }) }))

import { registerDesktopChromeHandlers } from './desktop-chrome'

const records = [
  ['worktree /repo/B', 'HEAD abc', 'branch refs/heads/main'],
  ['worktree /copies/中文 空格', 'HEAD def', 'branch refs/heads/feature/ui'],
  ['worktree /gone', 'HEAD gone', 'prunable missing gitdir'],
  ['worktree /bare', 'bare'],
]

describe('desktop.gitWorktrees ownership and valid checkouts', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.runGit.mockReset()
    mocks.runGit.mockResolvedValue({ ok: true, stdout: records.map((r) => r.join('\0') + '\0\0').join('') })
    registerDesktopChromeHandlers()
  })

  it('reads the requested recent workspace rather than the previous Worker cwd', async () => {
    await mocks.handlers.get('ipc:desktop.gitWorktrees')!({ workspaceId: '/repo/B' })
    expect(mocks.runGit).toHaveBeenCalledWith('/repo/B', ['worktree', 'list', '--porcelain', '-z'], expect.any(Object))
  })

  it('returns one repository identity and excludes prunable/bare entries without losing Unicode', async () => {
    const result = await mocks.handlers.get('ipc:desktop.gitWorktrees')!({ workspaceId: '/repo/B' })
    expect(result).toMatchObject({ ok: true, repositoryPath: '/repo/B', trees: [
      { path: '/repo/B', branch: 'main', isMain: true },
      { path: '/copies/中文 空格', branch: 'feature/ui', isMain: false },
    ] })
  })

  it('rejects an unregistered directory instead of silently querying another project', async () => {
    await expect(mocks.handlers.get('ipc:desktop.gitWorktrees')!({ workspaceId: '/unregistered' })).rejects.toThrow()
    expect(mocks.runGit).not.toHaveBeenCalled()
  })
})
