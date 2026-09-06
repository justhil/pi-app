import { stat } from 'fs/promises'
import type { GitWorktree, GitWorktreeList } from '@shared/git-worktree'
import { wslPathToWindows } from '@shared/wsl-path'
import { runGitReadOnly } from './git-workspace'
import { getAgentRuntimeConfig } from './wsl/runtime-config'

export async function listGitWorktrees(cwd: string): Promise<GitWorktreeList> {
  try {
    if (!(await stat(cwd)).isDirectory()) return { ok: true, repositoryPath: null, trees: [], missing: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: true, repositoryPath: null, trees: [], missing: true }
    throw error
  }
  const result = await runGitReadOnly(cwd, ['worktree', 'list', '--porcelain', '-z'], { timeout: 4000 })
  if (!result.ok) {
    return { ok: result.notRepo, repositoryPath: null, trees: [], ...(!result.notRepo && { error: result.message }) }
  }
  const runtime = getAgentRuntimeConfig()
  const toHost = (path: string) => runtime.mode === 'wsl' && runtime.distro
    ? wslPathToWindows(runtime.distro, path)
    : path
  const records = result.stdout.split('\0\0').filter(Boolean).map((record) => record.split('\0'))
  const repositoryPath = records[0]?.find((field) => field.startsWith('worktree '))?.slice(9)
  const trees: GitWorktree[] = []
  for (const [index, fields] of records.entries()) {
    const rawPath = fields.find((field) => field.startsWith('worktree '))?.slice(9)
    if (!rawPath || fields.includes('bare') || fields.some((field) => field === 'prunable' || field.startsWith('prunable '))) continue
    const path = toHost(rawPath)
    try {
      if (!(await stat(path)).isDirectory()) continue
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw error
    }
    trees.push({
      path,
      branch: fields.find((field) => field.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, ''),
      isMain: index === 0,
      detached: fields.includes('detached'),
    })
  }
  return { ok: true, repositoryPath: repositoryPath ? toHost(repositoryPath) : null, trees }
}
