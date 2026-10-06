import { gitExec, isGitRepository } from './git-workspace'

export type BranchStatus = {
  isRepo: boolean
  /** null = detached HEAD */
  branch: string | null
  head: string
  upstream: string | null
  ahead: number
  behind: number
  /** Changed + untracked paths. */
  dirty: number
}

export type BranchRef = {
  name: string
  /** `origin/x` for remote-tracking refs */
  remote: boolean
  head: string
  /** Unix seconds of the tip commit */
  date: number
  upstream: string | null
  current: boolean
  /** Checked out in another worktree (git refuses to switch to it here). */
  worktree: string | null
}

export type SwitchRequest = { name: string; remote?: boolean; create?: boolean; stash?: boolean }
export type SwitchResult =
  | { ok: true; branch: string; stashed: boolean }
  | { ok: false; reason: 'dirty-conflict'; files: string[] }
  | { ok: false; reason: 'invalid-name' | 'git'; message: string }

/** Message of the stash made when switching away from `from`; `restoreFor` finds it again. */
export const STASH_PREFIX = 'pi-desktop: switch '
const stashMessage = (from: string, to: string) => `${STASH_PREFIX}${from} → ${to}`

const firstLine = (s: string) => s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''

/** `git status --porcelain=v2 --branch` → branch, upstream, ahead/behind and dirty count. */
export function parseBranchStatus(out: string): Omit<BranchStatus, 'isRepo'> {
  let branch: string | null = null
  let head = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let dirty = 0
  for (const line of out.split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.oid ')) head = line.slice(13).trim() === '(initial)' ? '' : line.slice(13, 25).trim()
    else if (line.startsWith('# branch.head ')) {
      const h = line.slice(14).trim()
      branch = h === '(detached)' ? null : h
    } else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (!line.startsWith('#')) dirty++
  }
  return { branch, head, upstream, ahead, behind, dirty }
}

export async function readBranchStatus(cwd: string): Promise<BranchStatus> {
  const empty: BranchStatus = { isRepo: false, branch: null, head: '', upstream: null, ahead: 0, behind: 0, dirty: 0 }
  if (!isGitRepository(cwd)) return empty
  const r = await gitExec(cwd, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { timeout: 8000 })
  if (r.status !== 0) return empty
  return { isRepo: true, ...parseBranchStatus(r.stdout) }
}

const SEP = '\u0000'

/** `for-each-ref` rows → branches, newest tip first; remote `HEAD` aliases skipped. */
export function parseBranchRefs(out: string, cwd: string): BranchRef[] {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const here = norm(cwd)
  const refs: BranchRef[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [ref, head, date, upstream, worktree, mark] = line.split(SEP)
    const remote = ref.startsWith('refs/remotes/')
    if (!remote && !ref.startsWith('refs/heads/')) continue
    const name = ref.slice(remote ? 13 : 11)
    if (remote && name.endsWith('/HEAD')) continue
    const current = mark?.trim() === '*'
    const wt = worktree?.trim() || null
    refs.push({
      name,
      remote,
      head: head ?? '',
      date: Number(date) || 0,
      upstream: upstream?.trim() || null,
      current,
      worktree: wt && !current && norm(wt) !== here ? wt : null,
    })
  }
  return refs.sort((a, b) => Number(b.current) - Number(a.current) || b.date - a.date)
}

export async function listBranches(cwd: string): Promise<BranchRef[]> {
  if (!isGitRepository(cwd)) return []
  const format = ['%(refname)', '%(objectname:short)', '%(committerdate:unix)', '%(upstream:short)', '%(worktreepath)', '%(HEAD)'].join('%00')
  const r = await gitExec(cwd, ['--no-optional-locks', 'for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'], { timeout: 8000 })
  return r.status === 0 ? parseBranchRefs(r.stdout, cwd) : []
}

/**
 * Paths git refuses to overwrite: it lists them tab-indented under its (localised) "Your local changes … would be
 * overwritten" / "untracked working tree files" message, so the indentation is the locale-independent signal.
 */
export function overwrittenFiles(stderr: string): string[] | null {
  const files = stderr
    .split('\n')
    .filter((l) => /^\t/.test(l))
    .map((l) => l.trim())
    .filter(Boolean)
  return files.length ? files : null
}

async function currentBranch(cwd: string): Promise<string | null> {
  const r = await gitExec(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 })
  return r.status === 0 ? r.stdout.trim() || null : null
}

/**
 * Switch (or create and switch). Changes in the working tree travel along when git allows it; when git
 * refuses because they would be overwritten, the caller gets the files and may retry with `stash`.
 */
export async function switchBranch(cwd: string, req: SwitchRequest): Promise<SwitchResult> {
  if (!isGitRepository(cwd)) return { ok: false, reason: 'git', message: 'not a git repository' }
  const name = req.name.trim()
  let target = name
  let args: string[]
  if (req.create) {
    const valid = await gitExec(cwd, ['check-ref-format', '--branch', name], { timeout: 5000 })
    if (!name || valid.status !== 0) return { ok: false, reason: 'invalid-name', message: firstLine(valid.stderr) || name }
    args = ['switch', '-c', name]
  } else if (req.remote) {
    // origin/feat → local feat (tracking); reuse an existing local branch of that name.
    target = name.slice(name.indexOf('/') + 1)
    const exists = await gitExec(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${target}`], { timeout: 5000 })
    args = exists.status === 0 ? ['switch', target] : ['switch', '-c', target, '--track', name]
  } else {
    args = ['switch', name]
  }

  let stashed = false
  if (req.stash) {
    const from = (await currentBranch(cwd)) ?? 'HEAD'
    const s = await gitExec(cwd, ['stash', 'push', '--include-untracked', '-m', stashMessage(from, target)], { timeout: 60_000 })
    if (s.status !== 0) return { ok: false, reason: 'git', message: firstLine(s.stderr) || 'git stash failed' }
    stashed = !/No local changes to save/i.test(s.stdout + s.stderr)
  }

  const r = await gitExec(cwd, args, { timeout: 60_000 })
  if (r.status !== 0) {
    // Put the stash back so a failed switch leaves the tree as it was.
    if (stashed) await gitExec(cwd, ['stash', 'pop'], { timeout: 60_000 })
    const files = overwrittenFiles(r.stderr)
    if (files && !req.stash) return { ok: false, reason: 'dirty-conflict', files }
    return { ok: false, reason: 'git', message: firstLine(r.stderr) || 'git switch failed' }
  }
  return { ok: true, branch: target, stashed }
}

/** Newest stash this app made when leaving `branch` (offered back on return). */
export async function findSwitchStash(cwd: string, branch: string): Promise<{ ref: string; message: string } | null> {
  if (!isGitRepository(cwd)) return null
  const r = await gitExec(cwd, ['--no-optional-locks', 'stash', 'list', '--format=%gd%x00%gs'], { timeout: 8000 })
  if (r.status !== 0) return null
  for (const line of r.stdout.split('\n')) {
    const [ref, subject] = line.split(SEP)
    // Subject: "On <branch>: pi-desktop: switch <branch> → <to>"
    const msg = subject?.replace(/^On [^:]+: /, '') ?? ''
    if (ref && msg.startsWith(`${STASH_PREFIX}${branch} → `)) return { ref: ref.trim(), message: msg }
  }
  return null
}

export async function restoreSwitchStash(cwd: string, ref: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!/^stash@\{\d+\}$/.test(ref)) return { ok: false, message: 'invalid stash ref' }
  // A conflicting pop leaves the conflicts in the tree and keeps the stash (git's own behaviour).
  const r = await gitExec(cwd, ['stash', 'pop', ref], { timeout: 60_000 })
  return r.status === 0 ? { ok: true } : { ok: false, message: firstLine(r.stderr) || firstLine(r.stdout) || 'git stash pop failed' }
}
