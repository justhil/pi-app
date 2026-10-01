import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config-store', () => ({
  configStore: {
    get: vi.fn(() => undefined),
  },
}))

import { runGit, stageHunks, unstageHunks, readGitWorkspaceSnapshot } from '../git-workspace'

const tempDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-desktop-git-'))
  tempDirs.push(dir)
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'init'])
  return dir
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('git-workspace host mode', () => {
  it('runGit resolves branch in a real repo', () => {
    const dir = makeRepo()
    const r = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.stdout.trim()).toMatch(/^(master|main)$/)
  })

  it('runGit reports not-a-repo for a plain directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-desktop-notrepo-'))
    tempDirs.push(dir)
    const r = runGit(dir, ['status'], { timeout: 3000 })
    expect(r).toEqual({ ok: false, notRepo: true, message: '当前目录不是 Git 仓库' })
  })

  it('stageHunks stages a working-tree diff and unstageHunks reverses it', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n')
    const diff = execFileSync('git', ['diff'], { cwd: dir, encoding: 'utf-8' })
    expect(diff).toContain('@@')

    const staged = await stageHunks(dir, [{ path: 'a.txt', hunkPatches: [diff] }])
    expect(staged.ok).toBe(true)
    const cached = execFileSync('git', ['diff', '--cached'], { cwd: dir, encoding: 'utf-8' })
    expect(cached).toContain('world')

    const unstaged = await unstageHunks(dir, [{ path: 'a.txt', hunkPatches: [diff] }])
    expect(unstaged.ok).toBe(true)
    const cachedAfter = execFileSync('git', ['diff', '--cached'], { cwd: dir, encoding: 'utf-8' })
    expect(cachedAfter).toBe('')
  })

  it('readGitWorkspaceSnapshot returns repo metadata', async () => {
    const dir = makeRepo()
    const snap = await readGitWorkspaceSnapshot(dir)
    expect(snap.isRepo).toBe(true)
    expect(snap.branch).toMatch(/^(master|main)$/)
    expect(typeof snap.raw).toBe('string')
    expect(typeof snap.stagedRaw).toBe('string')
    expect(typeof snap.status).toBe('string')
    expect(snap.log).toContain('init')
  })

  it('readGitWorkspaceSnapshot_keeps_staged_and_untracked_diffs', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'extra.txt'), 'fresh\n')
    const snap = await readGitWorkspaceSnapshot(dir)
    expect(snap.stagedRaw).toContain('world')
    expect(snap.status).toContain('extra.txt')
    expect(snap.raw).toContain('fresh')
  })
})
