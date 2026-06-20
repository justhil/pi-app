import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

function isNotGitRepo(stderr: string, message: string): boolean {
  const s = `${message}\n${stderr}`.toLowerCase()
  return (
    s.includes('not a git repository') ||
    s.includes('not a git repo') ||
    s.includes('fatal: not a git')
  )
}

/** 工作区是否为 git 仓库（含 .git 目录或文件） */
export function isGitRepository(cwd: string): boolean {
  if (!cwd) return false
  return existsSync(join(cwd, '.git'))
}

export function runGit(
  cwd: string,
  args: string,
  options?: { timeout?: number; maxBuffer?: number },
): { ok: true; stdout: string } | { ok: false; notRepo: boolean; message: string } {
  if (!isGitRepository(cwd)) {
    return { ok: false, notRepo: true, message: '当前目录不是 Git 仓库' }
  }
  try {
    const stdout = execSync(`git ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: options?.timeout ?? 8000,
      maxBuffer: options?.maxBuffer ?? 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout: stdout ?? '' }
  } catch (e: any) {
    const stderr = (e.stderr?.toString?.() || '').trim()
    const message = (e.message || String(e)).trim()
    if (isNotGitRepo(stderr, message)) {
      return { ok: false, notRepo: true, message: '当前目录不是 Git 仓库' }
    }
    const short = stderr.split('\n').find((l: string) => l.trim()) || message.split('\n')[0] || 'git 命令失败'
    return { ok: false, notRepo: false, message: short.slice(0, 500) }
  }
}

export type GitWorkspaceSnapshot = {
  isRepo: boolean
  branch: string
  raw: string
  status: string
  log: string
  message?: string
}

export function readGitWorkspaceSnapshot(cwd: string): GitWorkspaceSnapshot {
  if (!isGitRepository(cwd)) {
    return {
      isRepo: false,
      branch: '',
      raw: '',
      status: '',
      log: '',
      message: '当前目录不是 Git 仓库',
    }
  }

  const branchR = runGit(cwd, 'rev-parse --abbrev-ref HEAD', { timeout: 3000 })
  const branch = branchR.ok ? branchR.stdout.trim() : ''

  const diffR = runGit(cwd, 'diff', { timeout: 10000 })
  const raw = diffR.ok ? diffR.stdout : ''

  const statusR = runGit(cwd, 'status --porcelain -b', { timeout: 5000 })
  const status = statusR.ok ? statusR.stdout : ''

  const logR = runGit(cwd, 'log --oneline -12', { timeout: 5000 })
  const log = logR.ok ? logR.stdout.trim() : ''

  if (!diffR.ok && diffR.notRepo) {
    return { isRepo: false, branch: '', raw: '', status: '', log: '', message: diffR.message }
  }

  return { isRepo: true, branch, raw, status, log }
}