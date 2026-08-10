import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { basename, join, relative, sep } from 'path'
import { promisify } from 'util'
import type {
  WorkspaceFsSearchEntry,
  WorkspaceFsSearchRequest,
  WorkspaceFsSearchResponse,
} from '@shared/ipc-contract'
import { resolvePathUnderWorkspace } from './workspace-fs'
import { resolveActiveAgentDir } from './agent-dir'

const execFileAsync = promisify(execFile)
const FD_ENUMERATION_LIMIT = 100
const SEARCH_RESULT_LIMIT = 20
const SEARCH_TIMEOUT_MS = 2500

let cachedFdExecutable: string | null | undefined
let warnedSearchFailure = false

export function clearWorkspaceFileSearchCaches(): void {
  cachedFdExecutable = undefined
  warnedSearchFailure = false
}

export interface WorkspaceFileSearchQuery {
  ok: true
  scopeAbs: string
  scopePrefix: string
  query: string
}

export function buildWorkspaceFileSearchQuery(
  workspaceRoot: string,
  inputQuery: string,
): WorkspaceFileSearchQuery | { ok: false; error: 'missing_root' | 'outside_workspace' | 'search_failed' } {
  if (!workspaceRoot.trim()) return { ok: false, error: 'missing_root' }
  const normalized = inputQuery.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return { ok: false, error: 'outside_workspace' }
  }
  const slash = normalized.lastIndexOf('/')
  const scope = slash >= 0 ? normalized.slice(0, slash) : ''
  const query = slash >= 0 ? normalized.slice(slash + 1) : normalized
  if (scope.split('/').some((part) => part === '..')) {
    return { ok: false, error: 'outside_workspace' }
  }
  const resolved = resolvePathUnderWorkspace(workspaceRoot, scope || '.')
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error === 'missing_root' ? 'missing_root' : 'outside_workspace',
    }
  }
  try {
    if (!statSync(resolved.abs).isDirectory()) return { ok: false, error: 'search_failed' }
  } catch {
    return { ok: false, error: 'search_failed' }
  }
  const scopePrefix = scope ? `${scope.replace(/^\.\//, '').replace(/\/+$/, '')}/` : ''
  return { ok: true, scopeAbs: resolved.abs, scopePrefix, query }
}

export function scoreWorkspaceFileSearchEntry(entry: WorkspaceFsSearchEntry, query: string): number {
  if (!query) return entry.isDirectory ? 10 : 0
  const normalizedQuery = query.toLocaleLowerCase()
  const name = entry.name.toLocaleLowerCase()
  const path = entry.path.toLocaleLowerCase()
  let score = 0
  if (name === normalizedQuery) score = 100
  else if (name.startsWith(normalizedQuery)) score = 80
  else if (name.includes(normalizedQuery)) score = 50
  else if (path.includes(normalizedQuery)) score = 30
  return score > 0 && entry.isDirectory ? score + 10 : score
}

export function rankWorkspaceFileSearchEntries(
  entries: WorkspaceFsSearchEntry[],
  query: string,
  maxResults = SEARCH_RESULT_LIMIT,
): WorkspaceFsSearchEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, score: scoreWorkspaceFileSearchEntry(entry, query) }))
    .filter((item) => !query || item.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const pathOrder = a.entry.path.localeCompare(b.entry.path, undefined, { sensitivity: 'base' })
      return pathOrder || a.index - b.index
    })
    .slice(0, Math.min(Math.max(1, maxResults), SEARCH_RESULT_LIMIT))
    .map((item) => item.entry)
}

async function verifyFdExecutable(candidate: string): Promise<boolean> {
  try {
    await execFileAsync(candidate, ['--version'], {
      windowsHide: true,
      timeout: 1500,
    })
    return true
  } catch {
    return false
  }
}

export async function resolveFdExecutable(): Promise<string | null> {
  if (cachedFdExecutable !== undefined) return cachedFdExecutable
  const agentDir = process.env.PI_CODING_AGENT_DIR || resolveActiveAgentDir()
  const managed = join(agentDir, 'bin', process.platform === 'win32' ? 'fd.exe' : 'fd')
  if (existsSync(managed)) {
    cachedFdExecutable = managed
    return managed
  }
  for (const candidate of ['fd', 'fdfind']) {
    if (await verifyFdExecutable(candidate)) {
      cachedFdExecutable = candidate
      return candidate
    }
  }
  cachedFdExecutable = null
  return null
}

export async function workspaceFsSearch(
  req: WorkspaceFsSearchRequest,
): Promise<WorkspaceFsSearchResponse> {
  const scoped = buildWorkspaceFileSearchQuery(String(req.workspaceRoot || ''), String(req.query || ''))
  if (!scoped.ok) return { ok: false, entries: [], error: scoped.error }
  const fd = await resolveFdExecutable()
  if (!fd) return { ok: false, entries: [], error: 'fd_unavailable' }

  const args = [
    '--base-directory',
    scoped.scopeAbs,
    '--max-results',
    String(FD_ENUMERATION_LIMIT),
    '--type',
    'file',
    '--type',
    'directory',
    '--follow',
    '--hidden',
    '--exclude',
    '.git',
    '--path-separator',
    '/',
  ]
  if (scoped.query) args.push('--fixed-strings', '--ignore-case', '--full-path', scoped.query)
  else args.push('.')

  try {
    const { stdout } = await execFileAsync(fd, args, {
      cwd: scoped.scopeAbs,
      encoding: 'utf8',
      windowsHide: true,
      timeout: SEARCH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })
    const rootResolved = resolvePathUnderWorkspace(req.workspaceRoot, '.')
    if (!rootResolved.ok) {
      return {
        ok: false,
        entries: [],
        error: rootResolved.error === 'missing_root' ? 'missing_root' : 'outside_workspace',
      }
    }
    const entries: WorkspaceFsSearchEntry[] = []
    for (const raw of stdout.split(/\r?\n/)) {
      const relativeFromScope = raw.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/$/, '')
      if (!relativeFromScope) continue
      const relativePath = `${scoped.scopePrefix}${relativeFromScope}`.replace(/^\.\//, '')
      if (relativePath === '.git' || relativePath.startsWith('.git/')) continue
      const resolved = resolvePathUnderWorkspace(req.workspaceRoot, relativePath)
      if (!resolved.ok) continue
      try {
        const pathFromRoot = relative(rootResolved.abs, resolved.abs).split(sep).join('/')
        if (!pathFromRoot || pathFromRoot.startsWith('../')) continue
        const isDirectory = statSync(resolved.abs).isDirectory()
        entries.push({
          path: relativePath,
          name: basename(relativePath),
          isDirectory,
        })
      } catch {
        continue
      }
    }
    return {
      ok: true,
      entries: rankWorkspaceFileSearchEntries(entries, scoped.query, req.maxResults),
    }
  } catch (error) {
    if (!warnedSearchFailure) {
      warnedSearchFailure = true
      console.warn('[workspace.fs.search] fd search failed:', error)
    }
    return { ok: false, entries: [], error: 'search_failed' }
  }
}
