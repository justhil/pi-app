import { watch, type FSWatcher } from 'fs'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { getTrustedWorkspaceRoot } from './trusted-workspace'
import { isGitRepository } from './git-workspace'
import { isWslWindowsPath } from '@shared/wsl-path'
import { isWslRuntimeActive } from './wsl/runtime-config'

/** WSL/UNC 或 WSL 原生路径：Windows 宿主 fs.watch 无法可靠监听（9P 不支持递归），跳过。 */
function isWslPath(cwd: string): boolean {
  return (
    isWslWindowsPath(cwd) ||
    (isWslRuntimeActive() && cwd.startsWith('/') && !/^\/[a-zA-Z]:/.test(cwd))
  )
}

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let watchedCwd: string | null = null

function notifyGitChanged(win: BrowserWindow | null, cwd: string): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('ipc:git-workspace-changed', { cwd })
}

export function stopGitWorkspaceWatch(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  watcher?.close()
  watcher = null
  watchedCwd = null
}

export function refreshGitWorkspaceWatch(win: BrowserWindow | null): void {
  stopGitWorkspaceWatch()
  const cwd = getTrustedWorkspaceRoot()
  if (!cwd || !isGitRepository(cwd)) return
  watchedCwd = cwd
  if (isWslPath(cwd)) {
    // WSL 发行版内 git 变更由 worker 内的 git 状态读取驱动，主进程不监听 UNC 目录。
    return
  }
  const gitDir = join(cwd, '.git')
  try {
    watcher = watch(gitDir, { recursive: true }, () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (watchedCwd) notifyGitChanged(win, watchedCwd)
      }, 400)
    })
  } catch (e) {
    console.warn('[git-watch] failed:', e)
  }
}