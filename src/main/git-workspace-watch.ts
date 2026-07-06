import { watch, type FSWatcher } from 'fs'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { getTrustedWorkspaceRoot } from './trusted-workspace'
import { isGitRepository } from './git-workspace'

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