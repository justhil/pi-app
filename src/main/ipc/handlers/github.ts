import { z } from 'zod'
import { registerHandlerWithSchema } from '../registry'
import { authorizeProjectCwd } from '../../trusted-workspace'
import {
  listRepoIssues,
  listRepoPullRequests,
  readBranchPullRequest,
  readPullRequestDetail,
} from '../../github-status'

const branchPrSchema = z.object({
  cwd: z.string().optional(),
  branch: z.string().min(1).max(250),
  force: z.boolean().optional(),
})

const listSchema = z.object({
  cwd: z.string().optional(),
  state: z.enum(['open', 'closed', 'all']).optional(),
  involvement: z.enum(['all', 'authored', 'assigned', 'involved']).optional(),
  search: z.string().max(200).optional(),
  force: z.boolean().optional(),
})

const detailSchema = z.object({
  cwd: z.string().optional(),
  number: z.number().int().positive(),
  force: z.boolean().optional(),
})

export function registerGitHubHandlers(): void {
  registerHandlerWithSchema('ipc:github.branchPr', branchPrSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    if (!cwd.ok) return { ok: false, pr: null, errorCode: 'not-git', error: cwd.error }
    return readBranchPullRequest(cwd.cwd, req.branch, req.force)
  })

  registerHandlerWithSchema('ipc:github.listPrs', listSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    if (!cwd.ok) return { ok: false, items: [], errorCode: 'not-git', error: cwd.error }
    return listRepoPullRequests(cwd.cwd, {
      state: req.state,
      involvement: req.involvement,
      search: req.search,
      force: req.force,
    })
  })

  registerHandlerWithSchema('ipc:github.listIssues', listSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    if (!cwd.ok) return { ok: false, items: [], errorCode: 'not-git', error: cwd.error }
    return listRepoIssues(cwd.cwd, {
      state: req.state,
      involvement: req.involvement,
      search: req.search,
      force: req.force,
    })
  })

  registerHandlerWithSchema('ipc:github.prDetail', detailSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    if (!cwd.ok) return { ok: false, pr: null, errorCode: 'not-git', error: cwd.error }
    return readPullRequestDetail(cwd.cwd, req.number, req.force)
  })
}
