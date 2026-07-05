import { registerHandler, registerHandlerWithSchema } from '../registry'
import { reviewMutationSchema } from '../schemas'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { readGitWorkspaceSnapshot, stageHunks, unstageHunks, commitChanges } from '../../git-workspace'
import { authorizeTrustedCwd, getTrustedWorkspaceRoot } from '../../trusted-workspace'

function reviewMutationCwd(reqCwd?: string): { ok: true; cwd: string } | { ok: false; error: string } {
  return authorizeTrustedCwd(reqCwd)
}

export function registerReviewHandlers(): void {
  registerHandler('ipc:review.getDiff', async (req) => {
    const cwd = getTrustedWorkspaceRoot() || process.cwd()
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

  registerHandlerWithSchema('ipc:review.stageHunks', reviewMutationSchema, async (req) => {
    const cwd = reviewMutationCwd(req.cwd)
    if (!cwd.ok) return { ok: false, error: cwd.error }
    const r = stageHunks(cwd.cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

  registerHandlerWithSchema('ipc:review.unstageHunks', reviewMutationSchema, async (req) => {
    const cwd = reviewMutationCwd(req.cwd)
    if (!cwd.ok) return { ok: false, error: cwd.error }
    const r = unstageHunks(cwd.cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

  registerHandlerWithSchema('ipc:review.commit', reviewMutationSchema, async (req) => {
    const cwd = reviewMutationCwd(req.cwd)
    if (!cwd.ok) return { ok: false, error: cwd.error }
    const r = commitChanges(cwd.cwd, req.message || '')
    return { ok: r.ok, error: r.error, commitHash: r.commitHash }
  })
}