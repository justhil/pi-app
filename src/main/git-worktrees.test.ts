import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { workspacePathsEqual } from '@shared/workspace-path'

vi.mock('./wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => ({ mode: 'host', distro: null }) }))
import { listGitWorktrees } from './git-worktrees'

let root: string
let main: string
let feature: string
let detached: string
let missing: string
function git(args: string[]) {
  return execFileSync('git', ['-c', `core.hooksPath=${join(root, 'no-hooks')}`, ...args], { cwd: main, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-sidebar-git-'))
  main = join(root, 'main repo')
  feature = join(root, '中文 工作副本')
  detached = join(root, 'detached')
  missing = join(root, 'removed checkout')
  await mkdir(main)
  git(['init', '-b', 'main'])
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture'])
  git(['worktree', 'add', '-b', 'feature/sidebar', feature])
  git(['worktree', 'add', '--detach', detached])
  git(['worktree', 'add', '--detach', missing])
  await rm(missing, { recursive: true })
})

afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

describe('real Git worktree enumeration', () => {
  it('reads the same repository from a secondary checkout with Unicode and spaces', async () => {
    const result = await listGitWorktrees(feature)
    expect(result.ok).toBe(true)
    expect(workspacePathsEqual(result.repositoryPath, main)).toBe(true)
    expect(result.trees).toHaveLength(3)
    expect(result.trees.find((tree) => workspacePathsEqual(tree.path, feature))).toMatchObject({ branch: 'feature/sidebar', isMain: false, detached: false })
    expect(result.trees.find((tree) => workspacePathsEqual(tree.path, detached))).toMatchObject({ detached: true })
    expect(result.trees.some((tree) => workspacePathsEqual(tree.path, missing))).toBe(false)
    expect(git(['worktree', 'list', '--porcelain', '-z'])).toContain('prunable')
  })
  it('marks a removed recent checkout unavailable instead of treating it as an ordinary folder', async () => {
    expect(await listGitWorktrees(missing)).toEqual({ ok: true, repositoryPath: null, trees: [], missing: true })
  })
  it('keeps non-Git folders ordinary without surfacing a false failure', async () => {
    expect(await listGitWorktrees(root)).toEqual({ ok: true, repositoryPath: null, trees: [] })
  })
})
