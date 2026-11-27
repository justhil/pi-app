/**
 * Read pi-rewind git checkpoints (bounded — avoid N×git on main thread).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runGit } from './git-workspace'

const REF_PREFIX = 'refs/pi-checkpoints/'
const MAX_CHECKPOINTS = 24

function resolveGitDirFast(cwd: string): string | null {
  try {
    const dotGit = join(cwd, '.git')
    if (!existsSync(dotGit)) return null
    const st = statSync(dotGit)
    if (st.isDirectory()) return dotGit
    if (st.isFile()) {
      const line = readFileSync(dotGit, 'utf8').trim()
      const m = line.match(/^gitdir:\s*(.+)$/i)
      if (m?.[1]) return resolve(cwd, m[1].trim())
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Avoid spawning git on repositories that have never recorded any pi-rewind checkpoint ref. */
function hasRewindCheckpointRefs(cwd: string): boolean {
  const gitDir = resolveGitDirFast(cwd)
  if (!gitDir) return false
  try {
    if (existsSync(join(gitDir, 'refs', 'pi-checkpoints'))) return true
    const packedPath = join(gitDir, 'packed-refs')
    if (existsSync(packedPath)) {
      const content = readFileSync(packedPath, 'utf8')
      if (content.includes(REF_PREFIX)) return true
    }
    // Worktrees share common refs under `commondir`.
    const commonFile = join(gitDir, 'commondir')
    if (existsSync(commonFile)) {
      const commonDir = resolve(gitDir, readFileSync(commonFile, 'utf8').trim())
      if (existsSync(join(commonDir, 'refs', 'pi-checkpoints'))) return true
      const commonPacked = join(commonDir, 'packed-refs')
      if (existsSync(commonPacked) && readFileSync(commonPacked, 'utf8').includes(REF_PREFIX)) return true
    }
  } catch {
    /* fall through to git when uncertain */
    return true
  }
  return false
}

export type RewindCheckpointRow = {
  id: string
  sessionId: string
  trigger: string
  turnIndex: number
  toolName?: string
  description?: string
  branch: string
  timestamp: number
  worktreeTreeSha: string
}

function parseCommitMessage(msg: string, refName: string): RewindCheckpointRow | null {
  const get = (key: string) => msg.match(new RegExp(`^${key} (.+)$`, 'm'))?.[1]?.trim()
  const sid = get('sessionId')
  const turn = get('turn')
  const wt = get('worktree-tree')
  if (!sid || !turn || !wt) return null
  const created = get('created')
  return {
    id: refName,
    sessionId: sid,
    trigger: get('trigger') || 'turn',
    turnIndex: parseInt(turn, 10),
    toolName: get('toolName'),
    description: get('description'),
    branch: get('branch') || 'unknown',
    timestamp: created ? new Date(created).getTime() : 0,
    worktreeTreeSha: wt,
  }
}

/** List recent checkpoints; caps count and uses one batch cat-file when possible. */
export function listRewindCheckpoints(cwd: string, sessionId?: string): RewindCheckpointRow[] {
  if (!hasRewindCheckpointRefs(cwd)) return []
  const listR = runGit(
    cwd,
    ['for-each-ref', '--format=%(refname)', 'refs/pi-checkpoints', '--sort=-committerdate'],
    { timeout: 8000 },
  )
  if (!listR.ok) return []

  const refs = listR.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(REF_PREFIX))
    .map((line) => line.slice(REF_PREFIX.length))
    .slice(0, MAX_CHECKPOINTS)

  if (refs.length === 0) return []

  // Batch: rev-parse all SHAs in one call
  const verifyArgs = refs.map((r) => `${REF_PREFIX}${r}`).join(' ')
  const revR = runGit(cwd, ['rev-parse', ...verifyArgs.split(' ').filter(Boolean)], { timeout: 8000 })
  if (!revR.ok) return []
  const shas = revR.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  if (shas.length !== refs.length) return []

  const out: RewindCheckpointRow[] = []
  // Single cat-file per checkpoint still heavy — cap already at 24; 3s total budget via short timeout each
  for (let i = 0; i < refs.length; i++) {
    const cat = runGit(cwd, ['cat-file', 'commit', shas[i]], { timeout: 2000, maxBuffer: 128 * 1024 })
    if (!cat.ok) continue
    const row = parseCommitMessage(cat.stdout, refs[i])
    if (!row) continue
    if (sessionId && row.sessionId !== sessionId) continue
    out.push(row)
  }
  out.sort((a, b) => b.timestamp - a.timestamp)
  return out
}