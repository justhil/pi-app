import { execFile, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getAgentRuntimeConfig } from './wsl/runtime-config'
import { runGitInWsl, runGitInWslAsync } from './wsl/git-delegate'

function activeWslDistro(): string | null {
  const { mode, distro } = getAgentRuntimeConfig()
  return mode === 'wsl' && distro ? distro : null
}

function gitExecSync(
  cwd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number; input?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const distro = activeWslDistro()
  if (distro) {
    const r = runGitInWsl(distro, cwd, args, { timeout: opts.timeout, input: opts.input })
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
  }
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: opts.timeout ?? 8000,
      maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
      input: opts.input,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { status: 0, stdout: stdout ?? '', stderr: '' }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: { toString(): string }; stderr?: { toString(): string } }
    return {
      status: typeof err.status === 'number' ? err.status : -1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    }
  }
}

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
  args: string[],
  options?: { timeout?: number; maxBuffer?: number; input?: string },
): { ok: true; stdout: string } | { ok: false; notRepo: boolean; message: string } {
  if (!isGitRepository(cwd)) {
    return { ok: false, notRepo: true, message: '当前目录不是 Git 仓库' }
  }
  const r = gitExecSync(cwd, args, options)
  if (r.status !== 0) {
    const message = (r.stderr || r.stdout || '').trim() || 'git 命令失败'
    if (isNotGitRepo(r.stderr, message)) {
      return { ok: false, notRepo: true, message: '当前目录不是 Git 仓库' }
    }
    const short = r.stderr.split('\n').find((l: string) => l.trim()) || message.split('\n')[0] || 'git 命令失败'
    return { ok: false, notRepo: false, message: short.slice(0, 500) }
  }
  return { ok: true, stdout: r.stdout ?? '' }
}

async function gitExec(
  cwd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  const distro = activeWslDistro()
  if (distro) {
    const r = await runGitInWslAsync(distro, cwd, args, {
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
    })
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
  }
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: opts.timeout ?? 8000,
      maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const e = error as NodeJS.ErrnoException & { code?: string | number } | null
      resolve({
        status: error ? typeof e?.code === 'number' ? e.code : -1 : 0,
        stdout: stdout ?? '',
        stderr: stderr ?? error?.message ?? '',
      })
    })
  })
}

async function runGitReadOnly(
  cwd: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number },
): Promise<{ ok: true; stdout: string } | { ok: false; notRepo: boolean; message: string }> {
  if (!isGitRepository(cwd)) {
    return { ok: false, notRepo: true, message: '当前目录不是 Git 仓库' }
  }
  const r = await gitExec(cwd, args, options)
  if (r.status !== 0) {
    const message = (r.stderr || r.stdout || '').trim() || 'git 命令失败'
    if (isNotGitRepo(r.stderr, message)) {
      return { ok: false, notRepo: true, message: '当前目录不是 Git 仓库' }
    }
    const short = r.stderr.split('\n').find((line) => line.trim()) || message.split('\n')[0] || 'git 命令失败'
    return { ok: false, notRepo: false, message: short.slice(0, 500) }
  }
  return { ok: true, stdout: r.stdout ?? '' }
}

export type GitWorkspaceSnapshot = {
  isRepo: boolean
  branch: string
  raw: string
  status: string
  log: string
  message?: string
}

export async function readGitWorkspaceSnapshot(cwd: string): Promise<GitWorkspaceSnapshot> {
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

  const [branchR, diffR, statusR, logR] = await Promise.all([
    runGitReadOnly(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000 }),
    runGitReadOnly(cwd, ['diff'], { timeout: 10000 }),
    runGitReadOnly(cwd, ['status', '--porcelain', '-b'], { timeout: 5000 }),
    runGitReadOnly(cwd, ['log', '--oneline', '-12'], { timeout: 5000 }),
  ])
  const branch = branchR.ok ? branchR.stdout.trim() : ''
  const raw = diffR.ok ? diffR.stdout : ''
  const status = statusR.ok ? statusR.stdout : ''
  const log = logR.ok ? logR.stdout.trim() : ''

  if (!diffR.ok && diffR.notRepo) {
    return { isRepo: false, branch: '', raw: '', status: '', log: '', message: diffR.message }
  }

  return { isRepo: true, branch, raw, status, log }
}

/** 选择性暂存 hunk：patch 来自已读真实 git diff，git apply --cached --recount */
export function stageHunks(
  cwd: string,
  files: { path: string; hunkPatches: string[] }[],
): { ok: boolean; error?: string } {
  for (const f of files) {
    for (const patch of f.hunkPatches) {
      if (!patch || (!patch.startsWith('diff --git') && !patch.startsWith('@@'))) continue
      const r = gitExecSync(cwd, ['apply', '--cached', '--recount'], { timeout: 10000, input: patch })
      if (r.status !== 0) {
        return { ok: false, error: (r.stderr || 'git apply 失败').trim().slice(0, 500) }
      }
    }
  }
  return { ok: true }
}

/** 反向应用 patch 撤销暂存 */
export function unstageHunks(
  cwd: string,
  files: { path: string; hunkPatches: string[] }[],
): { ok: boolean; error?: string } {
  for (const f of files) {
    for (const patch of f.hunkPatches) {
      if (!patch) continue
      const r = gitExecSync(cwd, ['apply', '-R', '--cached'], { timeout: 10000, input: patch })
      if (r.status !== 0) {
        return { ok: false, error: (r.stderr || 'git apply -R 失败').trim().slice(0, 500) }
      }
    }
  }
  return { ok: true }
}

/** 提交：message 经 stdin（-F -）传入，避免临时文件与 shell 注入问题 */
export function commitChanges(
  cwd: string,
  message: string,
): { ok: boolean; error?: string; commitHash?: string } {
  if (!message.trim()) return { ok: false, error: 'commit message 为空' }
  const r = runGit(cwd, ['commit', '-F', '-'], { timeout: 15000, input: message })
  if (!r.ok) return { ok: false, error: r.message }
  const hashR = runGit(cwd, ['rev-parse', 'HEAD'], { timeout: 3000 })
  return { ok: true, commitHash: hashR.ok ? hashR.stdout.trim() : undefined }
}