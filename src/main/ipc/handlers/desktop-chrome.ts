import { app, powerSaveBlocker, dialog } from 'electron'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { z } from 'zod'
import { workspacePathsEqual } from '@shared/workspace-path'
import { configStore } from '../../config-store'
import { listGitWorktrees } from '../../git-worktrees'
import { workerManager } from '../../worker-manager'
import {
  listCompletionInbox,
  markCompletionInboxRead,
  markCompletionInboxUnread,
} from '../../completion-notification'
import { execFileSync } from 'child_process'
import { summarizeAppMemory } from '../../app-memory'
import { peekBrowserHost } from '../../browser/browser-host'
let sleepBlocker: number | null = null

export function registerDesktopChromeHandlers(): void {
  registerHandler('ipc:notifications.inbox', async () => ({ items: listCompletionInbox() }))
  registerHandler('ipc:notifications.markUnread', async (req) => {
    markCompletionInboxUnread(String(req.id || ''), req.unread !== false)
    return { ok: true }
  })
  registerHandler('ipc:notifications.markRead', async (req) => {
    markCompletionInboxRead(String(req.id || ''))
    return { ok: true }
  })

  registerHandler('ipc:desktop.status', async () => {
    const mem = process.memoryUsage()
    const rss = mem.rss
    const total = typeof process.getSystemMemoryInfo === 'function'
      ? process.getSystemMemoryInfo().total * 1024
      : 0
    const runtime = workerManager.listSessionRuntime()
    const browserPids = new Set(peekBrowserHost()?.pageProcessIds() ?? [])
    const appMemory = summarizeAppMemory(app.getAppMetrics(), browserPids)
    return {
      rss,
      total,
      app: appMemory,
      workers: runtime,
    }
  })

  registerHandler('ipc:desktop.killWorker', async (req) => {
    const file = String(req.sessionFile || '')
    if (!file) return { ok: false }
    await workerManager.abort(file)
    return { ok: true }
  })

  registerHandler('ipc:desktop.setSleepBlock', async (req) => {
    const on = req.on === true
    if (on && sleepBlocker == null) {
      sleepBlocker = powerSaveBlocker.start('prevent-app-suspension')
    } else if (!on && sleepBlocker != null) {
      powerSaveBlocker.stop(sleepBlocker)
      sleepBlocker = null
    }
    return { ok: true, blocking: sleepBlocker != null }
  })

  registerHandlerWithSchema('ipc:desktop.gitWorktrees', z.object({ workspaceId: z.string().min(1) }), async ({ workspaceId }) => {
    const known = [configStore.get('currentProject'), ...(configStore.get('recentProjects') || [])]
    const cwd = known.find((path) => workspacePathsEqual(path, workspaceId))
    if (!cwd) throw new Error('Workspace must be opened before listing worktrees')
    const listing = await listGitWorktrees(cwd)
    const rawHidden = configStore.get('hiddenWorktrees')
    const hidden = Array.isArray(rawHidden) ? rawHidden : []
    if (!hidden.length || !listing.trees.length) return listing
    return {
      ...listing,
      trees: listing.trees.filter((tree) => !hidden.some((h) => workspacePathsEqual(h, tree.path))),
    }
  })

  registerHandlerWithSchema(
    'ipc:desktop.createGitWorktree',
    z.object({ workspaceId: z.string().min(1), branch: z.string().min(1) }),
    async ({ workspaceId, branch }) => {
      const known = [configStore.get('currentProject'), ...(configStore.get('recentProjects') || [])]
      const cwd = known.find((path) => workspacePathsEqual(path, workspaceId)) || workspaceId
      const { createGitWorktree } = await import('../../git-worktree-ops')
      const res = await createGitWorktree(cwd, branch)
      if (res.ok && typeof configStore.addRecentProject === 'function') {
        configStore.addRecentProject(res.path)
      }
      return res
    },
  )

  registerHandlerWithSchema(
    'ipc:desktop.removeGitWorktree',
    z.object({ workspaceId: z.string().min(1), worktreePath: z.string().min(1) }),
    async ({ workspaceId, worktreePath }) => {
      const known = [configStore.get('currentProject'), ...(configStore.get('recentProjects') || [])]
      const cwd = known.find((path) => workspacePathsEqual(path, workspaceId)) || workspaceId
      const { removeGitWorktree } = await import('../../git-worktree-ops')
      const res = await removeGitWorktree(cwd, worktreePath)
      if (!res.ok) return res
      if (typeof configStore.removeRecentProject === 'function') {
        configStore.removeRecentProject(worktreePath)
      }
      if (res.repositoryPath && typeof configStore.addRecentProject === 'function') {
        const recent = configStore.get('recentProjects') || []
        if (!recent.some((p) => workspacePathsEqual(p, res.repositoryPath))) {
          configStore.addRecentProject(res.repositoryPath)
        }
      }
      const cur = configStore.get('currentProject')
      if (cur && workspacePathsEqual(cur, worktreePath)) {
        const next = res.repositoryPath || (configStore.get('recentProjects') || [])[0] || null
        configStore.set('currentProject', next)
      }
      return {
        ok: true,
        repositoryPath: res.repositoryPath,
        currentProject: configStore.get('currentProject'),
        recentProjects: configStore.get('recentProjects') || [],
      }
    },
  )

  registerHandler('ipc:desktop.pairingCode', async () => {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    return { ok: true, code, url: `pi-desktop://pair/${code}` }
  })

  registerHandler('ipc:desktop.crashCopy', async (req) => {
    return { ok: true, text: String(req.detail || '') }
  })

  registerHandler('ipc:desktop.pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return { ok: !r.canceled, path: r.filePaths[0] }
  })

  registerHandler('ipc:desktop.appName', async () => ({ name: app.getName(), version: app.getVersion() }))
  // Renderer shell has painted: start background warm-up (kept off the first-paint path).
  registerHandler('ipc:app.shellReady', async () => {
    setTimeout(() => void import('../../startup-warmup').then((m) => m.runStartupWarmup()), 300)
    return { ok: true }
  })

  registerHandler('ipc:desktop.setBadge', async (req) => {
    const n = Number(req.count) || 0
    if (typeof app.setBadgeCount === 'function') app.setBadgeCount(n)
    return { ok: true }
  })

  registerHandler('ipc:desktop.whichPi', async () => {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      const out = execFileSync(cmd, ['pi'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
      return { ok: !!out, path: out || '' }
    } catch {
      return { ok: false, path: '' }
    }
  })
}
