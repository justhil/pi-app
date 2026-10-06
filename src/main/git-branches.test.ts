import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./wsl/runtime-config', () => ({ getAgentRuntimeConfig: () => ({ mode: 'host', distro: null }), isWslRuntimeActive: () => false }))
import { findSwitchStash, listBranches, overwrittenFiles, parseBranchStatus, readBranchStatus, restoreSwitchStash, switchBranch } from './git-branches'

let root: string
let repo: string
let other: string
const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
const commit = (msg: string) => git(['commit', '-qam', msg])

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-branches-'))
  repo = join(root, 'repo')
  other = join(root, 'other')
  await mkdir(repo)
  git(['init', '-q', '-b', 'main'])
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(root, 'none')]]) git(['config', k, v])
  await writeFile(join(repo, 'a.txt'), 'one\n')
  git(['add', '.'])
  commit('init')
  git(['branch', 'dev'])
  git(['switch', '-q', 'dev'])
  await writeFile(join(repo, 'a.txt'), 'dev\n')
  commit('dev change')
  git(['switch', '-q', 'main'])
  git(['branch', 'elsewhere'])
  git(['worktree', 'add', '-q', other, 'elsewhere'])
})

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('parsers', () => {
  it('reads branch, upstream, ahead/behind and dirty count', () => {
    const s = parseBranchStatus('# branch.oid 0123456789abcdef\n# branch.head feat/x\n# branch.upstream origin/feat/x\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f\n? new.txt\n')
    expect(s).toEqual({ branch: 'feat/x', head: '0123456789ab', upstream: 'origin/feat/x', ahead: 2, behind: 1, dirty: 2 })
    expect(parseBranchStatus('# branch.oid abc\n# branch.head (detached)\n').branch).toBeNull()
  })

  it('collects the files git refuses to overwrite', () => {
    const err = 'error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n\tsrc/b.ts\nPlease commit your changes or stash them before you switch branches.\nAborting\n'
    expect(overwrittenFiles(err)).toEqual(['a.txt', 'src/b.ts'])
    expect(overwrittenFiles("fatal: invalid reference: nope")).toBeNull()
  })
})

describe('real repository', () => {
  it('lists branches with the current one first and marks other worktrees', async () => {
    const refs = await listBranches(repo)
    expect(refs[0]).toMatchObject({ name: 'main', current: true, remote: false })
    expect(refs.find((r) => r.name === 'elsewhere')?.worktree).toBeTruthy()
    expect(refs.find((r) => r.name === 'dev')?.worktree).toBeNull()
  })

  it('switches, carrying non-conflicting changes along', async () => {
    await writeFile(join(repo, 'b.txt'), 'untracked\n')
    const r = await switchBranch(repo, { name: 'dev' })
    expect(r).toEqual({ ok: true, branch: 'dev', stashed: false })
    expect((await readBranchStatus(repo)).branch).toBe('dev')
    expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('untracked\n')
    await rm(join(repo, 'b.txt'))
  })

  it('reports conflicting changes, then stashes and offers them back on return', async () => {
    await writeFile(join(repo, 'a.txt'), 'local edit\n')
    const refused = await switchBranch(repo, { name: 'main' })
    expect(refused).toEqual({ ok: false, reason: 'dirty-conflict', files: ['a.txt'] })
    expect((await readBranchStatus(repo)).branch).toBe('dev')

    const r = await switchBranch(repo, { name: 'main', stash: true })
    expect(r).toEqual({ ok: true, branch: 'main', stashed: true })
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await findSwitchStash(repo, 'main')).toBeNull()

    await switchBranch(repo, { name: 'dev' })
    const stash = await findSwitchStash(repo, 'dev')
    expect(stash?.message).toBe('pi-desktop: switch dev → main')
    expect(await restoreSwitchStash(repo, stash!.ref)).toEqual({ ok: true })
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('local edit\n')
    git(['checkout', '--', 'a.txt'])
  })

  it('creates a branch from HEAD and rejects invalid names', async () => {
    expect(await switchBranch(repo, { name: 'bad..name', create: true })).toMatchObject({ ok: false, reason: 'invalid-name' })
    expect(await switchBranch(repo, { name: 'feat/new', create: true })).toEqual({ ok: true, branch: 'feat/new', stashed: false })
    const s = await readBranchStatus(repo)
    expect(s).toMatchObject({ isRepo: true, branch: 'feat/new', dirty: 0 })
  })

  it('refuses a branch checked out in another worktree', async () => {
    const r = await switchBranch(repo, { name: 'elsewhere' })
    expect(r).toMatchObject({ ok: false, reason: 'git' })
  })

  it('tracks a remote branch as a local one', async () => {
    const clone = join(root, 'clone')
    git(['clone', '-q', repo, clone], root)
    const refs = await listBranches(clone)
    expect(refs.some((x) => x.remote && x.name === 'origin/dev')).toBe(true)
    const r = await switchBranch(clone, { name: 'origin/dev', remote: true })
    expect(r).toMatchObject({ ok: true, branch: 'dev' })
    expect((await readBranchStatus(clone)).upstream).toBe('origin/dev')
  })
})
