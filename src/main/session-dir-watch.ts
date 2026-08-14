import { readdir, stat } from 'fs/promises'
import { watch, type FSWatcher } from 'fs'
import { join, resolve } from 'path'
import { app, type BrowserWindow } from 'electron'
import { configStore } from './config-store'
import { workerManager } from './worker-manager'
import { getPendingWorkerSessionFile } from './session-bind-state'
import { getActiveSdkModule } from './ipc/sdk-session'
import { sessionFilePathsEqual } from '@shared/session-file-path'

/**
 * 会话同步：监测当前工作区会话目录（~/.pi/agent/sessions/<编码cwd>/）的文件变化。
 * 路由：命中当前查看的会话文件 → `ipc:session-external-update`（渲染层只读合并尾部）；
 * 其余/新增文件 → `ipc:workspace-sessions-changed`（刷新侧栏列表）。
 * 切换工作区/会话时重新定向（一个 watcher，只 watch 当前工作区）。
 * Windows 丢事件兜底：事件触发后按 mtime 重扫目录 + 窗口聚焦时强制刷新。
 */

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let watchedWorkspace: string | null = null
let sessionDir: string | null = null
let knownMtimes = new Map<string, number>()
let focusedWin: BrowserWindow | null = null

// Windows fs.watch 丢事件兑底：定时轮询目录 mtime，检测到变化即触发与 watcher 相同的路由
const POLL_INTERVAL_MS = 3000

function stopWatcher(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  watcher?.close()
  watcher = null
  sessionDir = null
  watchedWorkspace = null
  knownMtimes.clear()
}

export function stopSessionDirWatch(): void {
  stopWatcher()
  if (focusedWin) {
    focusedWin.removeAllListeners('focus')
    focusedWin = null
  }
}

function send(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

async function currentSessionFiles(): Promise<string[]> {
  const files: string[] = []
  try {
    const st = (await workerManager.getState().catch(() => null)) as { sessionFile?: string } | null
    if (st?.sessionFile) files.push(st.sessionFile)
  } catch {
    /* fall through */
  }
  const pending = getPendingWorkerSessionFile()
  if (pending) files.push(pending)
  return files
}

async function seedKnownMtimes(): Promise<void> {
  if (!sessionDir) return
  try {
    const names = await readdir(sessionDir)
    const entries = await Promise.all(
      names
        .filter((n) => n.endsWith('.jsonl'))
        .map(async (n) => {
          try {
            const st = await stat(join(sessionDir!, n))
            return [n, st.mtimeMs] as const
          } catch {
            return null
          }
        }),
    )
    knownMtimes = new Map(entries.filter((e): e is readonly [string, number] => e != null))
  } catch {
    knownMtimes.clear()
  }
}

async function notifySessionDirChanged(win: BrowserWindow | null): Promise<void> {
  if (!sessionDir || !watchedWorkspace) return
  let names: string[]
  try {
    names = await readdir(sessionDir)
  } catch {
    return
  }
  const currentFiles = await currentSessionFiles()
  let otherTouched = false
  const nextMtimes = new Map<string, number>()
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    try {
      const st = await stat(join(sessionDir, n))
      nextMtimes.set(n, st.mtimeMs)
      const prev = knownMtimes.get(n)
      if (prev === undefined || st.mtimeMs > prev) {
        const full = join(sessionDir, n)
        // 任何变化的会话文件都通知渲染层做只读尾部合并；渲染层按“当前查看文件”
        // 自行过滤，不依赖主进程对 worker 绑定状态的判断（CLI 会话可能未被 worker 绑定）。
        send(win, 'ipc:session-external-update', { sessionFile: full })
        if (!currentFiles.some((c) => sessionFilePathsEqual(full, c))) otherTouched = true
      }
    } catch {
      /* deleted mid-scan */
    }
  }
  // 删除的文件（n 不再出现）也算列表变化
  if ([...knownMtimes.keys()].some((n) => !nextMtimes.has(n))) otherTouched = true
  knownMtimes = nextMtimes

  if (otherTouched) {
    send(win, 'ipc:workspace-sessions-changed', { workspaceId: watchedWorkspace })
  }
}

function scheduleNotify(win: BrowserWindow | null): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void notifySessionDirChanged(win)
  }, 500)
}

export async function refreshSessionDirWatch(win: BrowserWindow | null): Promise<void> {
  stopWatcher()
  const cwd = workerManager.cwd || configStore.get('currentProject') || ''
  if (!cwd || !win) return
  try {
    const { getAgentDir } = await getActiveSdkModule(app.getPath('userData'))
    // 与 SDK getDefaultSessionDir 同一编码：~/.pi/agent/sessions/--<cwd 转义>--
    const resolvedCwd = resolve(cwd)
    const safePath = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
    const dir = join(getAgentDir(), 'sessions', safePath)
    sessionDir = dir
    watchedWorkspace = cwd
    await seedKnownMtimes()
    watcher = watch(dir, { persistent: false }, () => scheduleNotify(win))
    watcher.on('error', () => {
      // 目录可能被删除/权限变化：仅关闭 watcher，保留定时轮询继续兜底
      watcher?.close()
      watcher = null
    })
    focusedWin = win
    win.removeAllListeners('focus')
    win.on('focus', () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void notifySessionDirChanged(win).then(() => {
          if (watchedWorkspace) send(win, 'ipc:workspace-sessions-changed', { workspaceId: watchedWorkspace })
        })
      }, 300)
    })
    // 定时轮询：即使 fs.watch 丢事件，也会按 mtime 检测到变化并自动同步到窗口
    pollTimer = setInterval(() => {
      void notifySessionDirChanged(focusedWin)
    }, POLL_INTERVAL_MS)
  } catch (e) {
    console.warn('[session-dir-watch] failed:', e)
  }
}
