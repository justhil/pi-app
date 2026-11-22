import { app, powerSaveBlocker, dialog } from 'electron'
import { open, readFile, stat } from 'node:fs/promises'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { z } from 'zod'
import {
  extractBackgroundTasksFromBranchEntries,
  isSafeBackgroundLogPath,
  sortBackgroundTasks,
  type BackgroundTaskSnapshot,
} from '@shared/background-tasks'
import { prepareAdapterCatalog } from '../../../extension-compat/adapter-loader'
import {
  collectAllowedBackgroundLogRules,
  listBackgroundJobsSpecs,
} from '../../../extension-compat/status-bar-adapters'
import { normalizeSessionFileKey } from '@shared/session-file-key'
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

  registerHandlerWithSchema(
    'ipc:backgroundTasks.list',
    z.object({
      sessionFile: z.string().max(4096).optional(),
      workspaceId: z.string().max(4096).optional(),
    }).optional(),
    async (req) => {
      const targetSession = req?.sessionFile?.trim() || undefined
      const projectDir = req?.workspaceId?.trim() || undefined
      await prepareAdapterCatalog(projectDir)
      const specs = listBackgroundJobsSpecs(projectDir)
      const live = await workerManager.listBackgroundTasks()
      const merged = new Map<string, BackgroundTaskSnapshot>()
      const liveKeys = new Set(live.liveSessionFiles.map((f) => normalizeSessionFileKey(f)))

      for (const task of live.tasks) {
        const key = `${normalizeSessionFileKey(task.sessionFile)}::${task.id}`
        merged.set(key, task)
      }

      // If the active session has no live worker yet, parse persisted JSONL history asynchronously
      // using declared `background-jobs-v1` adapter specs (never waking a cold worker).
      if (targetSession && specs.length > 0 && !liveKeys.has(normalizeSessionFileKey(targetSession))) {
        const keywords = [
          ...new Set(specs.flatMap((s) => [...s.tools, ...s.exitMessageTypes]).filter(Boolean)),
        ]
        try {
          const info = await stat(targetSession)
          if (info.isFile() && info.size > 0 && info.size <= 32 * 1024 * 1024) {
            const raw = await readFile(targetSession, 'utf8')
            const entries: unknown[] = []
            for (const line of raw.split(/\r?\n/)) {
              const trimmed = line.trim()
              if (!trimmed) continue
              if (keywords.length > 0 && !keywords.some((kw) => trimmed.includes(kw))) {
                continue
              }
              try {
                entries.push(JSON.parse(trimmed))
              } catch {
                /* skip malformed jsonl line */
              }
            }
            const persisted = extractBackgroundTasksFromBranchEntries(entries, targetSession, specs)
            for (const task of persisted) {
              const settled: BackgroundTaskSnapshot =
                task.status === 'running' ? { ...task, status: 'exited' } : task
              const key = `${normalizeSessionFileKey(settled.sessionFile)}::${settled.id}`
              if (!merged.has(key)) merged.set(key, settled)
            }
          }
        } catch {
          /* unreadable or missing session file */
        }
      }

      return {
        tasks: sortBackgroundTasks(merged.values()),
        activeAdaptersBySession: live.activeAdaptersBySession,
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:backgroundTasks.inspect',
    z.object({
      sessionFile: z.string().max(4096).optional(),
      workspaceId: z.string().max(4096).optional(),
      taskId: z.string().min(1).max(128),
      outputPath: z.string().max(4096).optional(),
    }),
    async (req) => {
      const fromWorker = await workerManager.inspectBackgroundTask(
        req.sessionFile,
        req.taskId,
        req.outputPath,
      )
      if (fromWorker && fromWorker.ok) return fromWorker

      // Fallback: safe tail-read strictly validated against adapter-declared `logFile` rules.
      const projectDir = req.workspaceId?.trim() || undefined
      await prepareAdapterCatalog(projectDir)
      const logRules = collectAllowedBackgroundLogRules(projectDir)
      if (req.outputPath && isSafeBackgroundLogPath(req.outputPath, logRules)) {
        try {
          const info = await stat(req.outputPath)
          if (info.isFile()) {
            const maxBytes = 16 * 1024
            const start = Math.max(0, info.size - maxBytes)
            const length = info.size - start
            const fh = await open(req.outputPath, 'r')
            try {
              const buf = Buffer.alloc(length)
              const { bytesRead } = await fh.read(buf, 0, length, start)
              let tail = buf.subarray(0, bytesRead).toString('utf8')
              if (start > 0) {
                const nl = tail.indexOf('\n')
                if (nl >= 0 && nl < 240) tail = tail.slice(nl + 1)
              }
              return { ok: true, task: null, tail, truncated: start > 0, sizeBytes: info.size }
            } finally {
              await fh.close()
            }
          }
        } catch {
          /* log file cleaned up */
        }
      }
      return fromWorker ?? { ok: true, task: null, tail: '', truncated: false, sizeBytes: 0 }
    },
  )

  registerHandlerWithSchema(
    'ipc:backgroundTasks.readLog',
    z.object({
      outputPath: z.string().min(1).max(4096),
      workspaceId: z.string().max(4096).optional(),
      offset: z.number().int().min(0).default(0),
      maxBytes: z.number().int().min(1024).max(256 * 1024).default(64 * 1024),
    }),
    async (req) => {
      const requestedOffset = req.offset ?? 0
      const maxBytes = req.maxBytes ?? 64 * 1024
      const projectDir = req.workspaceId?.trim() || undefined
      await prepareAdapterCatalog(projectDir)
      const logRules = collectAllowedBackgroundLogRules(projectDir)
      if (!isSafeBackgroundLogPath(req.outputPath, logRules)) {
        return { ok: false, error: 'Invalid background task log path', text: '', nextOffset: requestedOffset, sizeBytes: 0 }
      }
      try {
        const info = await stat(req.outputPath)
        if (!info.isFile()) {
          return { ok: false, error: 'Log file not found', text: '', nextOffset: requestedOffset, sizeBytes: 0 }
        }
        const sizeBytes = info.size
        // On initial open of a huge log (> 128KB), start near the last 128KB so xterm renders instantly.
        let start = requestedOffset
        let skippedPrefix = false
        if (start === 0 && sizeBytes > 128 * 1024) {
          start = sizeBytes - 128 * 1024
          skippedPrefix = true
        }
        if (start >= sizeBytes) {
          return { ok: true, text: '', nextOffset: sizeBytes, sizeBytes, skippedPrefix: false }
        }
        const length = Math.min(maxBytes, sizeBytes - start)
        const fh = await open(req.outputPath, 'r')
        try {
          const buf = Buffer.alloc(length)
          const { bytesRead } = await fh.read(buf, 0, length, start)
          const text = buf.subarray(0, bytesRead).toString('utf8')
          return {
            ok: true,
            text,
            nextOffset: start + bytesRead,
            sizeBytes,
            skippedPrefix,
          }
        } finally {
          await fh.close()
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          text: '',
          nextOffset: requestedOffset,
          sizeBytes: 0,
        }
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:backgroundTasks.kill',
    z.object({
      sessionFile: z.string().min(1).max(4096),
      taskId: z.string().min(1).max(128),
    }),
    async (req) => workerManager.killBackgroundTask(req.sessionFile, req.taskId),
  )

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
    'ipc:desktop.gitWorktreesDetail',
    z.object({ workspaceId: z.string().min(1) }),
    async ({ workspaceId }) => {
      const known = [configStore.get('currentProject'), ...(configStore.get('recentProjects') || [])]
      const cwd = known.find((path) => workspacePathsEqual(path, workspaceId)) || workspaceId
      const listing = await listGitWorktrees(cwd)
      if (!listing.ok) return listing
      const rawHidden = configStore.get('hiddenWorktrees')
      const hidden = Array.isArray(rawHidden) ? rawHidden : []
      const visible = hidden.length
        ? listing.trees.filter((tree) => !hidden.some((h) => workspacePathsEqual(h, tree.path)))
        : listing.trees
      const { readBranchStatus } = await import('../../git-branches')
      const runtimeRows = workerManager.listSessionRuntime()
      const enriched = await Promise.all(
        visible.map(async (tree) => {
          const st = await readBranchStatus(tree.path).catch(() => null)
          const matchingRuntime = runtimeRows.filter((w) => workspacePathsEqual(w.cwd, tree.path))
          const runningRows = matchingRuntime.filter((w) => w.running)
          const dirtyCount = st?.dirty ?? 0
          const ahead = st?.ahead ?? 0
          const behind = st?.behind ?? 0
          const runningSessions = runningRows
            .filter((w) => w.sessionFile)
            .map((w) => ({
              sessionId: '',
              sessionFile: w.sessionFile || '',
            }))
          return {
            ...tree,
            dirtyCount,
            ahead,
            behind,
            runningCount: runningRows.length,
            runningSessions,
            isCleanIdle: !tree.isMain && runningRows.length === 0 && dirtyCount === 0 && ahead === 0,
          }
        }),
      )
      return { ...listing, trees: enriched }
    },
  )

  registerHandlerWithSchema(
    'ipc:desktop.launchWorktreeTask',
    z.object({
      workspaceId: z.string().min(1),
      branch: z.string().min(1),
      baseBranch: z.string().optional(),
      fromOrigin: z.boolean().optional(),
      prompt: z.string().min(1),
    }),
    async ({ workspaceId, branch, baseBranch, fromOrigin, prompt }) => {
      const known = [configStore.get('currentProject'), ...(configStore.get('recentProjects') || [])]
      const cwd = known.find((path) => workspacePathsEqual(path, workspaceId)) || workspaceId
      const { createGitWorktree } = await import('../../git-worktree-ops')
      const created = await createGitWorktree(cwd, branch, { baseBranch, fromOrigin })
      if (!created.ok) return created
      if (typeof configStore.addRecentProject === 'function') {
        configStore.addRecentProject(created.path)
      }
      const sess = await workerManager.newSessionInBackground(created.path)
      if (!sess.sessionFile) {
        return { ok: false, error: 'Failed to create background session in worktree' }
      }
      void workerManager.sendPrompt(prompt, sess.sessionFile).catch((err) => {
        console.error('[worktree-launch] sendPrompt failed:', err)
      })
      return {
        ok: true,
        path: created.path,
        branch: created.branch,
        sessionId: sess.sessionId,
        sessionFile: sess.sessionFile,
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:desktop.createGitWorktree',
    z.object({
      workspaceId: z.string().min(1),
      branch: z.string().min(1),
      baseBranch: z.string().optional(),
      fromOrigin: z.boolean().optional(),
      pullRequestNumber: z.number().int().positive().optional(),
    }),
    async ({ workspaceId, branch, baseBranch, fromOrigin, pullRequestNumber }) => {
      const known = [configStore.get('currentProject'), ...(configStore.get('recentProjects') || [])]
      const cwd = known.find((path) => workspacePathsEqual(path, workspaceId)) || workspaceId
      const { createGitWorktree } = await import('../../git-worktree-ops')
      const res = await createGitWorktree(cwd, branch, { baseBranch, fromOrigin, pullRequestNumber })
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
