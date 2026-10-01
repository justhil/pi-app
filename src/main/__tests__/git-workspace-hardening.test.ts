import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  active: 0,
  maxActive: 0,
  applyDelayMs: 0,
  syncCalls: 0,
  trustedRoot: null as string | null,
  wslRuntime: false,
  watchers: [] as Array<{ path: string; options: unknown; listener: (event: string, filename: string | null) => void; closed: boolean }>,
  wslGit: vi.fn(),
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const execFile = ((file: string, args: string[], options: unknown, callback: (...result: unknown[]) => void) => {
    const isApply = Array.isArray(args) && args[0] === 'apply'
    if (isApply) {
      mocks.active++
      mocks.maxActive = Math.max(mocks.maxActive, mocks.active)
    }
    return actual.execFile(file, args, options as object, (...result: unknown[]) => {
      const done = () => {
        if (isApply) mocks.active--
        callback(...result)
      }
      if (isApply && mocks.applyDelayMs) setTimeout(done, mocks.applyDelayMs)
      else done()
    })
  }) as unknown as typeof actual.execFile
  const execFileSyncTracked = ((...args: Parameters<typeof actual.execFileSync>) => {
    mocks.syncCalls++
    return actual.execFileSync(...args)
  }) as typeof actual.execFileSync
  const mod = { ...actual, execFile, execFileSync: execFileSyncTracked }
  return { ...mod, default: mod }
})
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const watch = ((path: string, options: unknown, listener: (event: string, filename: string | null) => void) => {
    const entry = { path: String(path), options, listener, closed: false }
    mocks.watchers.push(entry)
    return { close: () => { entry.closed = true } }
  }) as unknown as typeof actual.watch
  const mod = { ...actual, watch }
  return { ...mod, default: mod }
})
vi.mock('../trusted-workspace', () => ({ getTrustedWorkspaceRoot: () => mocks.trustedRoot }))
vi.mock('../wsl/runtime-config', () => ({
  isWslRuntimeActive: () => mocks.wslRuntime,
  getAgentRuntimeConfig: () => (mocks.wslRuntime ? { mode: 'wsl', distro: 'Ubuntu' } : { mode: 'host', distro: null }),
}))
vi.mock('../wsl/git-delegate', () => ({ runGitInWsl: vi.fn(), runGitInWslAsync: mocks.wslGit }))

import { stageHunks, unstageHunks } from '../git-workspace'
import { refreshGitWorkspaceWatch, stopGitWorkspaceWatch } from '../git-workspace-watch'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const dirs: string[] = []
const lines = (edit: (n: number) => string) => Array.from({ length: 30 }, (_, i) => edit(i + 1)).join('\n') + '\n'

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-git-hard-'))
  dirs.push(dir)
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@example.com')
  git(dir, 'config', 'user.name', 'T')
  writeFileSync(join(dir, 'a.txt'), lines((n) => `line ${n}`))
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** One full patch per hunk, as the review panel sends them. */
function hunkPatches(cwd: string): string[] {
  const diff = git(cwd, 'diff')
  const [header, ...hunks] = diff.split(/^(?=@@)/m)
  return hunks.map((hunk) => header + hunk)
}

function stagedFile(cwd: string): string {
  return git(cwd, 'show', ':a.txt')
}

beforeEach(() => {
  mocks.active = 0
  mocks.maxActive = 0
  mocks.applyDelayMs = 0
  mocks.syncCalls = 0
  mocks.trustedRoot = null
  mocks.wslRuntime = false
  mocks.watchers.length = 0
  mocks.wslGit.mockReset()
})
afterEach(() => {
  stopGitWorkspaceWatch()
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('R10 asynchronous ordered hunk staging', () => {
  it('should_stage_and_unstage_without_sync_git_when_called', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), lines((n) => (n === 2 || n === 25 ? `edited ${n}` : `line ${n}`)))
    const patches = hunkPatches(dir)
    expect(patches).toHaveLength(2)

    const pending = stageHunks(dir, [{ path: 'a.txt', hunkPatches: patches }])
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(stagedFile(dir)).toContain('edited 2')
    expect(stagedFile(dir)).toContain('edited 25')

    await expect(unstageHunks(dir, [{ path: 'a.txt', hunkPatches: [patches[1]] }])).resolves.toEqual({ ok: true })
    expect(stagedFile(dir)).toContain('edited 2')
    expect(stagedFile(dir)).not.toContain('edited 25')
    expect(mocks.syncCalls).toBe(0)
  })

  it('should_keep_earlier_hunks_and_report_error_when_a_later_hunk_fails', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'a.txt'), lines((n) => (n === 2 ? 'edited 2' : `line ${n}`)))
    const [good] = hunkPatches(dir)
    const bad = good.replace('-line 2', '-no such line')
    const result = await stageHunks(dir, [{ path: 'a.txt', hunkPatches: [good, bad] }])
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(stagedFile(dir)).toContain('edited 2')
  })

  it('should_serialize_writes_when_paths_alias_the_same_index_and_recover_after_failure', async () => {
    const dir = repo()
    const alias = `${dir}-alias`
    dirs.push(alias)
    symlinkSync(dir, alias, 'dir')
    writeFileSync(join(dir, 'a.txt'), lines((n) => (n === 2 || n === 25 ? `edited ${n}` : `line ${n}`)))
    const [first, second] = hunkPatches(dir)
    mocks.applyDelayMs = 40

    const results = await Promise.all([
      stageHunks(dir, [{ path: 'a.txt', hunkPatches: ['@@ -1 +1 @@\n-not here\n+x\n'] }]),
      stageHunks(alias, [{ path: 'a.txt', hunkPatches: [first] }]),
      stageHunks(dir, [{ path: 'a.txt', hunkPatches: [second] }]),
    ])

    expect(results.map((result) => result.ok)).toEqual([false, true, true])
    expect(mocks.maxActive).toBe(1)
    expect(stagedFile(dir)).toContain('edited 2')
    expect(stagedFile(dir)).toContain('edited 25')
  })

  it('should_run_writes_in_parallel_when_worktrees_have_separate_indexes', async () => {
    const dir = repo()
    const worktree = `${dir}-wt`
    dirs.push(worktree)
    git(dir, 'worktree', 'add', '-q', worktree)
    for (const cwd of [dir, worktree]) writeFileSync(join(cwd, 'a.txt'), lines((n) => (n === 2 ? `edited in ${cwd === dir ? 'main' : 'wt'}` : `line ${n}`)))
    mocks.applyDelayMs = 60
    const [main, wt] = await Promise.all([
      stageHunks(dir, [{ path: 'a.txt', hunkPatches: hunkPatches(dir) }]),
      stageHunks(worktree, [{ path: 'a.txt', hunkPatches: hunkPatches(worktree) }]),
    ])
    expect(main.ok && wt.ok).toBe(true)
    expect(mocks.maxActive).toBe(2)
    expect(stagedFile(dir)).toContain('edited in main')
    expect(stagedFile(worktree)).toContain('edited in wt')
  })

  it('should_pass_patch_via_stdin_to_wsl_git_when_workspace_is_in_wsl', async () => {
    mocks.wslRuntime = true
    mocks.wslGit.mockImplementation(async (_distro: string, _cwd: string, args: string[]) =>
      args[0] === 'rev-parse'
        ? { status: 0, stdout: '/home/u/p/.git\n/home/u/p/.git\n/home/u/p/.git/index\n', stderr: '' }
        : { status: 0, stdout: '', stderr: '' })
    const cwd = '\\\\wsl.localhost\\Ubuntu\\home\\u\\p'
    await expect(stageHunks(cwd, [{ path: 'a.txt', hunkPatches: ['@@ -1 +1 @@\n-a\n+b\n'] }])).resolves.toEqual({ ok: true })
    expect(mocks.wslGit).toHaveBeenCalledWith('Ubuntu', cwd, ['apply', '--cached', '--recount'], expect.objectContaining({ input: '@@ -1 +1 @@\n-a\n+b\n' }))
    expect(mocks.syncCalls).toBe(0)
  })
})

describe('R11 watch real git metadata', () => {
  const win = () => {
    const send = vi.fn()
    return { send, win: { isDestroyed: () => false, webContents: { send } } as never }
  }

  it('should_watch_git_dir_once_when_repository_is_plain', async () => {
    const dir = repo()
    mocks.trustedRoot = dir
    await refreshGitWorkspaceWatch(win().win)
    expect(mocks.watchers.map((watcher) => watcher.path)).toEqual([join(dir, '.git')])
  })

  it('should_notify_when_worktree_index_or_shared_refs_change', async () => {
    const dir = repo()
    const worktree = `${dir}-wt`
    dirs.push(worktree)
    git(dir, 'worktree', 'add', '-q', worktree)
    expect(readFileSync(join(worktree, '.git'), 'utf8')).toMatch(/^gitdir:/)
    mocks.trustedRoot = worktree
    const { send, win: window } = win()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await refreshGitWorkspaceWatch(window)

    const live = mocks.watchers.filter((watcher) => !watcher.closed)
    expect(live.map((watcher) => watcher.path)).toEqual([join(dir, '.git')])
    live[0].listener('change', 'worktrees/' + worktree.split(/[\\/]/).pop() + '/index')
    vi.advanceTimersByTime(400)
    expect(send).toHaveBeenCalledWith('ipc:git-workspace-changed', { cwd: worktree })
    live[0].listener('change', 'refs/heads/main.lock')
    live[0].listener('change', 'refs/heads/main')
    vi.advanceTimersByTime(400)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('should_install_only_latest_project_watch_when_project_switches_during_resolution', async () => {
    const a = repo()
    const b = repo()
    mocks.trustedRoot = a
    const first = refreshGitWorkspaceWatch(win().win)
    mocks.trustedRoot = b
    const second = refreshGitWorkspaceWatch(win().win)
    await Promise.all([first, second])
    const live = mocks.watchers.filter((watcher) => !watcher.closed)
    expect(live.map((watcher) => watcher.path)).toEqual([join(b, '.git')])
  })

  it('should_close_watchers_and_pending_notification_when_stopped', async () => {
    const dir = repo()
    mocks.trustedRoot = dir
    const { send, win: window } = win()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await refreshGitWorkspaceWatch(window)
    mocks.watchers[0].listener('change', 'index')
    stopGitWorkspaceWatch()
    vi.advanceTimersByTime(1000)
    expect(mocks.watchers.every((watcher) => watcher.closed)).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('should_not_use_host_watch_when_workspace_is_wsl_unc', async () => {
    mocks.trustedRoot = '\\\\wsl.localhost\\Ubuntu\\home\\u\\p'
    await refreshGitWorkspaceWatch(win().win)
    expect(mocks.watchers).toHaveLength(0)
  })
})
