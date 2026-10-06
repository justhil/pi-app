import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { registerHandlerWithSchema } from '../registry'
import { authorizeProjectCwd } from '../../trusted-workspace'
import { findSwitchStash, listBranches, readBranchStatus, restoreSwitchStash, switchBranch } from '../../git-branches'

const cwdSchema = z.object({ cwd: z.string().optional() }).passthrough()
const switchSchema = z.object({
  cwd: z.string().optional(),
  name: z.string().min(1).max(250),
  remote: z.boolean().optional(),
  create: z.boolean().optional(),
  stash: z.boolean().optional(),
})
const restoreSchema = z.object({ cwd: z.string().optional(), ref: z.string().regex(/^stash@\{\d+\}$/) })

/** Review / Files / the status bar refresh on this; the .git watcher would too, but later and per window. */
function announce(cwd: string): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('ipc:git-workspace-changed', { cwd })
}

export function registerGitBranchHandlers(): void {
  registerHandlerWithSchema('ipc:git.branchStatus', cwdSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    if (!cwd.ok) return { isRepo: false, branch: null, head: '', upstream: null, ahead: 0, behind: 0, dirty: 0 }
    return readBranchStatus(cwd.cwd)
  })

  registerHandlerWithSchema('ipc:git.branches', cwdSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    return { branches: cwd.ok ? await listBranches(cwd.cwd) : [] }
  })

  registerHandlerWithSchema('ipc:git.switchBranch', switchSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    if (!cwd.ok) return { ok: false, reason: 'git', message: cwd.error }
    const r = await switchBranch(cwd.cwd, req)
    if (!r.ok) return r
    announce(cwd.cwd)
    // Coming back to a branch this app stashed changes for: offer them back.
    const stash = await findSwitchStash(cwd.cwd, r.branch)
    return { ...r, restorable: stash }
  })

  registerHandlerWithSchema('ipc:git.restoreStash', restoreSchema, async (req) => {
    const cwd = authorizeProjectCwd(req.cwd)
    if (!cwd.ok) return { ok: false, message: cwd.error }
    const r = await restoreSwitchStash(cwd.cwd, req.ref)
    announce(cwd.cwd)
    return r
  })
}

