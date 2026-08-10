/**
 * Run git operations inside a WSL distro so the desktop review panel observes
 * the same git view as the worker (which runs inside WSL).
 *
 * The workspace root passed in is always a Windows-side path (`C:\...` or a
 * `\\wsl.localhost\...` UNC); we translate it to the WSL-native mount path
 * (`/mnt/c/...` / `/home/...`) and enter it via `wsl.exe --cd`.
 */

import { windowsPathToWsl } from '@shared/wsl-path'
import { isValidWslDistroName, runWslSync, type WslExecResult } from './wsl-exec'

export function runGitInWsl(
  distro: string,
  winCwd: string,
  args: string[],
  opts: { timeout?: number; input?: string } = {},
): WslExecResult {
  if (!isValidWslDistroName(distro)) {
    return { status: -1, stdout: '', stderr: `invalid wsl distro: ${String(distro)}` }
  }
  const wslCwd = windowsPathToWsl(distro, winCwd) || '/'
  return runWslSync(['-d', distro, '--cd', wslCwd, '--', 'git', ...args], {
    timeout: opts.timeout,
    input: opts.input,
  })
}
