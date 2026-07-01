import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { readGitWorkspaceSnapshot, stageHunks, unstageHunks, commitChanges } from '../../git-workspace'

export function registerReviewHandlers(): void {
  registerHandler('ipc:review.getDiff', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    if (req.scope === 'git') {
      const snap = readGitWorkspaceSnapshot(cwd)
      return {
        diff: {
          raw: snap.raw,
          status: snap.status,
          scope: 'git',
          branch: snap.branch,
          log: snap.log,
          isRepo: snap.isRepo,
          message: snap.message,
        },
      }
    }
    return { diff: { raw: '', status: '', scope: req.scope, isRepo: true } }
  })

  registerHandler('ipc:review.stageHunks', async (req) => {
    const cwd = req.cwd || workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const r = stageHunks(cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

  registerHandler('ipc:review.unstageHunks', async (req) => {
    const cwd = req.cwd || workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const r = unstageHunks(cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

  registerHandler('ipc:review.commit', async (req) => {
    const cwd = req.cwd || workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const r = commitChanges(cwd, req.message || '')
    return { ok: r.ok, error: r.error, commitHash: r.commitHash }
  })
}