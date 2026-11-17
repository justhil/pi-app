import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { HostBrowseResult, HostDirEntry } from '@shared/remote'
import {
  resolveProjectDisplayName,
  uniqueWorkspacePaths,
  workspacePathKey,
  workspacePathsEqual,
} from '@shared/workspace-path'
import { isWslWindowsPath, wslPathToWindows } from '@shared/wsl-path'
import { resolveActiveAgentDir, resolveActiveHomeDir } from './agent-dir'
import { configStore } from './config-store'
import { listGitWorktrees } from './git-worktrees'
import { isSandboxWorkspacePath, listSandboxWorkspaces, sandboxLabel } from './sandbox-workspaces'
import { readSessionMetaFromFile } from './session-file-meta'
import { getTrustedWorkspaceRoot } from './trusted-workspace'
import { workerManager } from './worker-manager'
import { getAgentRuntimeConfig } from './wsl/runtime-config'
import { awaitWslVm } from './wsl/wsl-env'
import { normalizeWorkspaceCwd } from './wsl/workspace-path'

const REFRESH_TTL_MS = 4_000
const BROWSE_ENTRY_CAP = 300
const GIT_PROBE_CAP = 120
const GIT_PROBE_CONCURRENCY = 16

type SessionFolderCache = { mtimeMs: number; cwd: string | null }

const sessionFolderCwds = new Map<string, SessionFolderCache>()
const worktreeMetaByKey = new Map<string, { branch?: string; repo?: string }>()
const admittedProjectPaths = new Map<string, string>()
let discoveredProjects: string[] = []
let refreshedAt = 0
let inflightRefresh: Promise<void> | null = null

function isPortableAbsolute(value: string): boolean {
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || isWslWindowsPath(value)
}

async function isExistingDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export function registerRemoteAuthorizedProject(cwd: string): string | null {
  const normalized = normalizeWorkspaceCwd(String(cwd || '').trim())
  const key = workspacePathKey(normalized)
  if (!normalized || !key || !isPortableAbsolute(normalized)) return null
  admittedProjectPaths.set(key, normalized)
  return normalized
}

export function isRemoteAuthorizedProject(cwd: string): boolean {
  const normalized = normalizeWorkspaceCwd(String(cwd || '').trim())
  const key = workspacePathKey(normalized)
  if (!normalized || !key || !isPortableAbsolute(normalized)) return false
  if (admittedProjectPaths.has(key)) return true
  if (discoveredProjects.some((p) => workspacePathKey(p) === key)) return true
  const remote = configStore.get('remote')
  if (remote?.enabled && remote?.allowAllProjects && !isWslWindowsPath(normalized)) {
    try {
      return existsSync(normalized)
    } catch {
      return false
    }
  }
  return false
}

export async function admitRemoteProject(rawPath: string): Promise<string | null> {
  const trimmed = String(rawPath || '').trim()
  if (!trimmed) return null
  await awaitWslVm()
  const normalized = normalizeWorkspaceCwd(isWslWindowsPath(trimmed) ? trimmed : resolve(trimmed))
  if (!isPortableAbsolute(normalized)) return null
  if (!(await isExistingDir(normalized))) return null
  return registerRemoteAuthorizedProject(normalized)
}

export function listKnownRemoteProjectsSync(): string[] {
  const liveWorkerCwds =
    typeof workerManager.listSessionRuntime === 'function'
      ? workerManager.listSessionRuntime().map((slot) => slot.cwd)
      : []
  const hidden = new Set((configStore.get('hiddenWorktrees') || []).map((p) => workspacePathKey(p)).filter(Boolean))
  const merged = uniqueWorkspacePaths([
    ...[getTrustedWorkspaceRoot(), configStore.get('currentProject'), ...(configStore.get('recentProjects') || [])].filter(
      (p): p is string => typeof p === 'string' && !!p.trim(),
    ),
    ...liveWorkerCwds.filter((p): p is string => typeof p === 'string' && !!p.trim()),
    ...admittedProjectPaths.values(),
    ...discoveredProjects,
  ])
  return merged.filter((p) => !hidden.has(workspacePathKey(p)))
}

export function describeRemoteProject(path: string): {
  label?: string
  temporary?: boolean
  branch?: string
  repo?: string
} {
  if (isSandboxWorkspacePath(path)) {
    const label = sandboxLabel(path)
    return { temporary: true, ...(label ? { label } : {}) }
  }
  const key = workspacePathKey(path)
  const wt = worktreeMetaByKey.get(key)
  const names = configStore.get('projectDisplayNames') || {}
  const folder = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
  const custom = resolveProjectDisplayName(names, path, '', { grouped: !!wt?.repo && !workspacePathsEqual(wt.repo, path) })
  return {
    ...(custom && custom !== folder ? { label: custom } : {}),
    ...(wt?.branch ? { branch: wt.branch } : {}),
    ...(wt?.repo ? { repo: wt.repo } : {}),
  }
}

async function discoverHistoricalSessionProjects(): Promise<string[]> {
  const sessionsRoot = join(resolveActiveAgentDir(), 'sessions')
  let dirs: Array<{ name: string; isDirectory(): boolean }>
  try {
    dirs = await readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const runtime = getAgentRuntimeConfig()
  const found: string[] = []
  const folderNames = dirs.filter((d) => d.isDirectory()).map((d) => d.name)

  await Promise.all(
    folderNames.map(async (folder) => {
      const fullDir = join(sessionsRoot, folder)
      let dirStat: Awaited<ReturnType<typeof stat>>
      try {
        dirStat = await stat(fullDir)
      } catch {
        return
      }
      const cached = sessionFolderCwds.get(fullDir)
      if (cached && cached.mtimeMs === dirStat.mtimeMs) {
        if (cached.cwd) found.push(cached.cwd)
        return
      }
      try {
        const files = (await readdir(fullDir)).filter((f) => f.endsWith('.jsonl')).sort()
        const sample = files[files.length - 1]
        if (!sample) {
          sessionFolderCwds.set(fullDir, { mtimeMs: dirStat.mtimeMs, cwd: null })
          return
        }
        const meta = await readSessionMetaFromFile(join(fullDir, sample)).catch(() => null)
        let cwd = meta?.cwd?.trim() || ''
        if (cwd && runtime.mode === 'wsl' && runtime.distro && cwd.startsWith('/')) {
          cwd = wslPathToWindows(runtime.distro, cwd)
        }
        const normalized = cwd ? normalizeWorkspaceCwd(cwd) : ''
        const ok = normalized && isPortableAbsolute(normalized) ? await isExistingDir(normalized) : false
        sessionFolderCwds.set(fullDir, { mtimeMs: dirStat.mtimeMs, cwd: ok ? normalized : null })
        if (ok) found.push(normalized)
      } catch {
        /* unreadable session folder */
      }
    }),
  )
  return found
}

export async function refreshKnownRemoteProjects(force = false): Promise<void> {
  if (!force && Date.now() - refreshedAt < REFRESH_TTL_MS) return
  if (inflightRefresh) return inflightRefresh
  inflightRefresh = (async () => {
    try {
      await awaitWslVm()
      const seeds = uniqueWorkspacePaths(
        [
          getTrustedWorkspaceRoot(),
          configStore.get('currentProject'),
          ...(configStore.get('recentProjects') || []),
          ...(typeof workerManager.listSessionRuntime === 'function'
            ? workerManager.listSessionRuntime().map((s) => s.cwd)
            : []),
        ].filter((p): p is string => typeof p === 'string' && !!p.trim()),
      )

      const [worktreeLists, sandboxes, historical] = await Promise.all([
        Promise.all(
          seeds
            .filter((p) => !isSandboxWorkspacePath(p))
            .map((p) => listGitWorktrees(p).catch(() => ({ ok: false as const, repositoryPath: null, trees: [] }))),
        ),
        listSandboxWorkspaces().catch(() => []),
        discoverHistoricalSessionProjects().catch(() => []),
      ])

      const worktreePaths: string[] = []
      for (const wt of worktreeLists) {
        if (!wt.ok) continue
        for (const tree of wt.trees) {
          worktreePaths.push(tree.path)
          worktreeMetaByKey.set(workspacePathKey(tree.path), {
            ...(tree.branch ? { branch: tree.branch } : {}),
            ...(wt.repositoryPath ? { repo: wt.repositoryPath } : {}),
          })
        }
      }

      const hidden = new Set((configStore.get('hiddenWorktrees') || []).map((p) => workspacePathKey(p)).filter(Boolean))
      discoveredProjects = uniqueWorkspacePaths([
        ...seeds,
        ...worktreePaths.filter((p) => !hidden.has(workspacePathKey(p))),
        ...historical,
        ...sandboxes.map((s) => s.path),
      ])
      for (const p of discoveredProjects) registerRemoteAuthorizedProject(p)
      refreshedAt = Date.now()
    } finally {
      inflightRefresh = null
    }
  })()
  return inflightRefresh
}

export function invalidateKnownRemoteProjects(): void {
  refreshedAt = 0
}

async function detectWindowsDrives(): Promise<string[]> {
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const results = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`
      const ok = await Promise.race([
        isExistingDir(root),
        new Promise<boolean>((r) => setTimeout(() => r(false), 250)),
      ])
      return ok ? root : null
    }),
  )
  return results.filter((r): r is string => !!r)
}

function computeParentDir(target: string): string | null {
  const norm = target.replace(/\\/g, '/').replace(/\/+$/, '')
  // WSL UNC share root: \\wsl.localhost\<distro> has no listable parent directory.
  if (/^\/\/(?:wsl\$|wsl\.localhost)\/[^/]+$/i.test(norm)) return null
  const parent = dirname(target)
  if (!parent || workspacePathsEqual(parent, target)) return null
  return parent
}

async function defaultBrowseStart(): Promise<string> {
  const candidates = [
    configStore.get('currentProject'),
    ...(configStore.get('recentProjects') || []),
  ]
    .filter((p): p is string => typeof p === 'string' && !!p.trim() && !isSandboxWorkspacePath(p))
    .map((p) => computeParentDir(p) ?? p)

  for (const c of [...candidates, resolveActiveHomeDir(), homedir()]) {
    if (c && (await isExistingDir(c))) return c
  }
  return process.platform === 'win32' ? 'C:\\' : '/'
}

export async function browseHostDirectory(rawPath?: string, dotfiles = false): Promise<HostBrowseResult> {
  await awaitWslVm()
  const activeHome = resolveActiveHomeDir()
  const rootsRaw: string[] = []
  if (activeHome && (await isExistingDir(activeHome))) rootsRaw.push(activeHome)
  const recentFirst = (configStore.get('recentProjects') || []).find((p) => p && !isSandboxWorkspacePath(p))
  const recentParent = recentFirst ? computeParentDir(recentFirst) : null
  if (recentParent && (await isExistingDir(recentParent))) rootsRaw.push(recentParent)
  if (process.platform === 'win32') {
    rootsRaw.push(...(await detectWindowsDrives()))
  } else {
    rootsRaw.push('/')
  }
  const roots = uniqueWorkspacePaths(rootsRaw)

  const requested = rawPath?.trim()
  const target = requested
    ? normalizeWorkspaceCwd(isWslWindowsPath(requested) ? requested : resolve(requested))
    : await defaultBrowseStart()

  if (!(await isExistingDir(target))) {
    const fallback = await defaultBrowseStart()
    return browseHostDirectory(fallback, dotfiles)
  }

  const dirents = await readdir(target, { withFileTypes: true }).catch(() => [])
  const subdirs = dirents
    .filter((d) => d.isDirectory() && (dotfiles || !d.name.startsWith('.')))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const truncated = subdirs.length > BROWSE_ENTRY_CAP
  const sliced = subdirs.slice(0, BROWSE_ENTRY_CAP)
  const entries: HostDirEntry[] = sliced.map((d) => ({
    name: d.name,
    path: join(target, d.name),
  }))

  // Probe `.git` in bounded batches so repositories stand out in the mobile folder picker.
  const probeTargets = entries.slice(0, GIT_PROBE_CAP)
  for (let i = 0; i < probeTargets.length; i += GIT_PROBE_CONCURRENCY) {
    const chunk = probeTargets.slice(i, i + GIT_PROBE_CONCURRENCY)
    await Promise.all(
      chunk.map(async (entry) => {
        const hasGit = await stat(join(entry.path, '.git')).then(() => true, () => false)
        if (hasGit) entry.git = true
      }),
    )
  }

  return {
    path: target,
    parent: computeParentDir(target),
    roots,
    entries,
    truncated,
  }
}
