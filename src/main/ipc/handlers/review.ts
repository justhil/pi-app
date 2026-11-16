import { registerHandler, registerHandlerWithSchema } from '../registry'
import { reviewMutationSchema } from '../schemas'
import { readGitWorkspaceSnapshot, stageHunks, unstageHunks } from '../../git-workspace'
import { authorizeProjectCwd, getTrustedWorkspaceRoot } from '../../trusted-workspace'

function reviewMutationCwd(reqCwd?: string): { ok: true; cwd: string } | { ok: false; error: string } {
  return authorizeProjectCwd(reqCwd)
}

export function registerReviewHandlers(): void {
  registerHandler('ipc:review.getDiff', async (req) => {
    let cwd: string
    if (typeof req.cwd === 'string' && req.cwd.trim()) {
      const auth = authorizeProjectCwd(req.cwd)
      if (!auth.ok) {
        return {
          diff: {
            raw: '',
            stagedRaw: '',
            status: '',
            scope: req.scope,
            isRepo: false,
            message: auth.error,
          },
        }
      }
      cwd = auth.cwd
    } else {
      cwd = getTrustedWorkspaceRoot() || process.cwd()
    }
    if (req.scope === 'git') {
      const snap = await readGitWorkspaceSnapshot(cwd)
      return {
        diff: {
          raw: snap.raw,
          stagedRaw: snap.stagedRaw,
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
    const r = await stageHunks(cwd.cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

  registerHandlerWithSchema('ipc:review.unstageHunks', reviewMutationSchema, async (req) => {
    const cwd = reviewMutationCwd(req.cwd)
    if (!cwd.ok) return { ok: false, error: cwd.error }
    const r = await unstageHunks(cwd.cwd, req.files || [])
    return { ok: r.ok, error: r.error }
  })

}