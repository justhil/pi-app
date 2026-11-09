import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { errorMessage } from '@shared/error-message'
import { sshDistroHost } from '@shared/wsl-path'
import { assertSshConnectionOptions, getStoredSshHosts, isValidSshHost } from './ssh-config'
import type { WslExecResult } from '../wsl/wsl-exec'

export { isSshDistro, isSshWindowsPath, sshDistroHost, toSshDistro } from '@shared/wsl-path'
export const SSH_EXE = 'ssh'

function expandLocalTilde(p: string): string {
  const trimmed = p.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2))
  }
  return trimmed
}

export function quotePosixArg(arg: string): string {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`
}

export function buildSshCliArgs(distroOrHost: string, opts?: { tty?: boolean; batchMode?: boolean }): string[] {
  const host = sshDistroHost(distroOrHost) ?? distroOrHost.trim()
  if (!isValidSshHost(host)) throw new Error('Invalid SSH host')
  const entry = getStoredSshHosts().find((item) => item.host === host)
  if (entry) assertSshConnectionOptions(entry)

  const args: string[] = []
  if (opts?.tty) args.push('-t')
  if (opts?.batchMode !== false) args.push('-o', 'BatchMode=yes')
  args.push('-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3')
  // OpenSSH applies ~/.ssh/config itself. Only app-saved overrides belong in argv.
  if (entry?.hostName) args.push('-o', `HostName=${entry.hostName}`)
  if (entry?.user) args.push('-l', entry.user)
  if (entry?.port) args.push('-p', String(entry.port))
  if (entry?.identityFile) args.push('-i', expandLocalTilde(entry.identityFile))
  args.push('--', host)
  return args
}

export function buildSshRemoteCommand(
  cwd: string | null | undefined,
  args: string[],
  envVars?: Record<string, string>,
): string {
  const envPrefix = envVars && Object.keys(envVars).length > 0
    ? ['env', ...Object.entries(envVars).map(([k, v]) => `${k}=${v}`)].map(quotePosixArg).join(' ') + ' '
    : ''
  const cmd = args.map(quotePosixArg).join(' ')
  if (!cwd) {
    return `${envPrefix}${cmd}`
  }
  if (cwd === '~') {
    return `cd && ${envPrefix}${cmd}`
  }
  if (cwd.startsWith('~/')) {
    return `cd -- "$HOME/"${quotePosixArg(cwd.slice(2))} && ${envPrefix}${cmd}`
  }
  return `cd -- ${quotePosixArg(cwd)} && ${envPrefix}${cmd}`
}

function sshExecResult(error: unknown, stdout = '', stderr = ''): WslExecResult {
  const failure = error as { status?: number; code?: unknown } | null
  const exitCode = failure?.status ?? failure?.code
  return {
    status: typeof exitCode === 'number' ? exitCode : error ? -1 : 0,
    stdout,
    stderr: stderr || (error ? errorMessage(error) : ''),
  }
}

export function runSshTargetSync(
  distro: string,
  cwd: string | null,
  args: string[],
  opts: { timeout?: number; input?: string } = {},
): WslExecResult {
  try {
    const sshArgs = [...buildSshCliArgs(distro), buildSshRemoteCommand(cwd, args)]
    const stdout = execFileSync(SSH_EXE, sshArgs, {
      encoding: 'utf8',
      timeout: opts.timeout ?? 15000,
      maxBuffer: 16 * 1024 * 1024,
      input: opts.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return sshExecResult(null, stdout)
  } catch (error) {
    const details = error as { stdout?: Buffer | string; stderr?: Buffer | string }
    return sshExecResult(error, String(details.stdout ?? ''), String(details.stderr ?? ''))
  }
}

export async function runSshTargetAsync(
  distro: string,
  cwd: string | null,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number; input?: string } = {},
): Promise<WslExecResult> {
  try {
    const sshArgs = [...buildSshCliArgs(distro), buildSshRemoteCommand(cwd, args)]
    return await new Promise<WslExecResult>((resolve) => {
      let inputError: Error | null = null
      const child = execFile(SSH_EXE, sshArgs, {
        encoding: 'utf8',
        timeout: opts.timeout ?? 20000,
        maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
        windowsHide: true,
      }, (error, stdout, stderr) => resolve(sshExecResult(error ?? inputError, stdout, stderr)))
      child.stdin?.once('error', (error) => { inputError = error })
      child.stdin?.end(opts.input)
    })
  } catch (error) {
    return sshExecResult(error)
  }
}

export function spawnSshTarget(opts: {
  distro: string
  cwd: string
  commandArgs: string[]
  envVars?: Record<string, string>
}): ChildProcess {
  const remoteCmd = buildSshRemoteCommand(opts.cwd, opts.commandArgs, opts.envVars)
  const sshArgs = [...buildSshCliArgs(opts.distro), remoteCmd]
  return spawn(SSH_EXE, sshArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

export interface RemoteDirEntry {
  name: string
  path: string
}

const LIST_DIRS_SH = [
  'target="${1:-$HOME}"',
  'case "$target" in "~") target="$HOME" ;; "~/"*) target="$HOME/${target#~/}" ;; esac',
  'cd -- "$target" 2>/dev/null || exit 1',
  'pwd_abs="$(pwd)"',
  'printf "CWD=%s\\n" "$pwd_abs"',
  'for d in * .[!.]*; do',
  '  [ -d "$d" ] || continue',
  '  [ "$d" = "." ] || [ "$d" = ".." ] || [ "$d" = ".git" ] && continue',
  '  printf "DIR=%s\\n" "$d"',
  'done',
].join('\n')

export async function listSshRemoteDirs(
  distro: string,
  dirPath?: string,
): Promise<{ ok: boolean; cwd: string; parent: string | null; dirs: RemoteDirEntry[]; error?: string }> {
  const target = (dirPath || '~').trim() || '~'
  const r = await runSshTargetAsync(distro, null, ['sh', '-s', '--', target], {
    input: LIST_DIRS_SH,
    timeout: 15000,
  })
  if (r.status !== 0) {
    return { ok: false, cwd: target, parent: null, dirs: [], error: (r.stderr || 'SSH directory listing failed').trim() }
  }
  let cwd = target
  const names: string[] = []
  for (const raw of r.stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('CWD=')) cwd = line.slice(4)
    else if (line.startsWith('DIR=')) names.push(line.slice(4))
  }
  names.sort((a, b) => {
    const aDot = a.startsWith('.')
    const bDot = b.startsWith('.')
    if (aDot !== bDot) return aDot ? 1 : -1
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
  const cleanCwd = cwd.replace(/\/+$/, '') || '/'
  const parent = cleanCwd === '/' ? null : cleanCwd.slice(0, cleanCwd.lastIndexOf('/')) || '/'
  const dirs = names.map((name) => ({
    name,
    path: cleanCwd === '/' ? `/${name}` : `${cleanCwd}/${name}`,
  }))
  return { ok: true, cwd: cleanCwd, parent, dirs }
}
