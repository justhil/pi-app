import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import { WORKER_STDIO_ENV, WORKER_WSL_DISTRO_ENV } from '@shared/worker-frame'
import { wslCdFlagSupported } from './worker-host'
import { syncWslBundle } from './bundle-sync'
import { wslNodeCommand } from './wsl-env'

export function syncPreviewBundleToWsl(distro: string): Promise<string | null> {
  return syncWslBundle(distro, 'preview-wsl.mjs')
}

export function spawnPreviewInWsl(opts: {
  distro: string
  wslCwd: string
  previewWslPath: string
}): ChildProcess {
  const args = ['-d', opts.distro]
  if (wslCdFlagSupported(opts.distro)) {
    args.push('--cd', opts.wslCwd, '--', ...wslNodeCommand(opts.distro, opts.previewWslPath))
  } else {
    const [bin, ...rest] = wslNodeCommand(opts.distro, opts.previewWslPath)
    args.push('--', 'bash', '-lc', 'cd -- "$1" && shift && exec "$@"', 'bash', opts.wslCwd, bin, ...rest)
  }
  const env: Record<string, string> = {
    ...process.env,
    [WORKER_STDIO_ENV]: '1',
    [WORKER_WSL_DISTRO_ENV]: opts.distro,
  }
  const inherited = process.env.WSLENV
  const requiredEnv = [WORKER_STDIO_ENV, WORKER_WSL_DISTRO_ENV]
  const existing = new Set(inherited?.split(':').map((entry) => entry.split('/')[0]))
  const missing = requiredEnv.filter((name) => !existing.has(name))
  if (missing.length) {
    env.WSLENV = [inherited, ...missing].filter(Boolean).join(':')
  }
  return spawn('wsl.exe', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env,
  })
}
