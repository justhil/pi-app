import { watch, type FSWatcher } from 'fs'
import { relative, isAbsolute } from 'path'
import type { BrowserWindow } from 'electron'
import { getTrustedWorkspaceRoot } from './trusted-workspace'
import { isGitRepository, resolveGitMetadataPaths } from './git-workspace'
import { isWslWindowsPath } from '@shared/wsl-path'
import { isWslRuntimeActive } from './wsl/runtime-config'

/** WSL/UNC 或 WSL 原生路径：Windows 宿主 fs.watch 无法可靠监听（9P 不支持递归），跳过。 */
function isWslPath(cwd: string): boolean {
  return (
    isWslWindowsPath(cwd) ||
    (isWslRuntimeActive() && cwd.startsWith('/') && !/^\/[a-zA-Z]:/.test(cwd))
  )
}

let watchers: FSWatcher[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let watchedCwd: string | null = null
/** Bumped on every refresh/stop so a slow metadata lookup cannot install a stale project's watch. */
let watchGeneration = 0

function shouldNotifyGitWorkspaceChange(filename: string | Buffer | null): boolean {
  if (filename == null) return true
  const basename = filename.toString().replace(/\\/g, '/').split('/').pop() || ''
  return !(
    basename.endsWith('.lock') ||
    basename === 'gc.log' ||
    basename === 'gc.pid' ||
    basename === 'maintenance.lock'
  )
}

function notifyGitChanged(win: BrowserWindow | null, cwd: string): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('ipc:git-workspace-changed', { cwd })
}

export function stopGitWorkspaceWatch(): void {
  watchGeneration++
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  for (const watcher of watchers) watcher.close()
  watchers = []
  watchedCwd = null
}

/** Drop targets nested in another target: a recursive watch on the parent already covers them. */
function outermostTargets(paths: string[]): string[] {
  const unique = [...new Set(paths)]
  return unique.filter((path) => !unique.some((other) => {
    if (other === path) return false
    const rel = relative(other, path)
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
  }))
}

/**
 * Watch the repository's real git-dir (index, HEAD) and common-dir (shared refs). In a worktree
 * `<cwd>/.git` is a pointer file, so its metadata lives elsewhere and must be resolved via git.
 */
export async function refreshGitWorkspaceWatch(win: BrowserWindow | null): Promise<void> {
  stopGitWorkspaceWatch()
  const generation = watchGeneration
  const cwd = getTrustedWorkspaceRoot()
  // WSL 发行版内 git 变更由 worker 内的 git 状态读取驱动，主进程不监听 UNC 目录。
  if (!cwd || isWslPath(cwd) || !isGitRepository(cwd)) return
  const paths = await resolveGitMetadataPaths(cwd).catch(() => null)
  if (generation !== watchGeneration || !paths) return
  watchedCwd = cwd
  const onChange = (_eventType: string, filename: string | Buffer | null): void => {
    if (!shouldNotifyGitWorkspaceChange(filename)) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (watchedCwd) notifyGitChanged(win, watchedCwd)
    }, 400)
  }
  for (const target of outermostTargets([paths.gitDir, paths.commonDir])) {
    try {
      watchers.push(watch(target, { recursive: true }, onChange))
    } catch (e) {
      console.warn('[git-watch] failed:', target, e)
    }
  }
}
