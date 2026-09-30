/**
 * Hosting the worker inside a WSL distro: syncing the built worker bundle into
 * the distro's home dir and spawning `wsl.exe -d <distro> --cd <cwd> -- node
 * worker.mjs` with stdio transport.
 */

import { spawn, type ChildProcess } from 'child_process'
import { WORKER_STDIO_ENV, WORKER_WSL_DISTRO_ENV } from '@shared/worker-frame'
import { runWslDistroCdSync, wslHomeDirSync } from './wsl-exec.js'
import { syncWslBundle } from './bundle-sync'
import { getCachedWslEnv, wslNodeCommand } from './wsl-env.js'

const cdSupportCache = new Map<string, boolean>()

export function invalidateWslCdSupportCache(): void {
  cdSupportCache.clear()
}

/** Whether `wsl.exe --cd` is supported for this distro (probed once, cached). */
export function wslCdFlagSupported(distro: string): boolean {
  const cached = cdSupportCache.get(distro)
  if (cached !== undefined) return cached
  const env = getCachedWslEnv(distro)
  if (env) {
    cdSupportCache.set(distro, env.cdSupported)
    return env.cdSupported
  }
  const result = runWslDistroCdSync(distro, '/', ['true'], { timeout: 8000 })
  const supported = result.status === 0
  cdSupportCache.set(distro, supported)
  return supported
}

/** Runtime directory inside the distro that caches the worker bundle. */
export function wslWorkerDirWsl(distro: string): string | null {
  const home = wslHomeDirSync(distro)
  return home ? `${home}/.pi-desktop` : null
}

export function wslWorkerBundleWsl(distro: string): string | null {
  const dir = wslWorkerDirWsl(distro)
  return dir ? `${dir}/worker.mjs` : null
}

/**
 * Copy the built `out/main/worker.mjs` (plus its ESM chunks) into the distro so
 * the worker can run under the distro's node without depending on a shared
 * folder mount. A `package.json` with `"type": "module"` is written alongside
 * so the `.js` chunk files are treated as ESM.
 *
 * Bundle content is hashed and a `worker.hash` marker written into the distro;
 * on later syncs the hash is compared first and the UNC write storm is skipped
 * when nothing changed (session switching forks workers repeatedly, so this
 * avoids re-copying ~240KB over the UNC mount on every fork).
 */
export function syncWorkerBundleToWsl(distro: string): Promise<string | null> {
  return syncWslBundle(distro, 'worker.mjs')
}

export interface SpawnWslWorkerOptions {
  distro: string
  wslCwd: string
  workerWslPath: string
}

export function spawnWorkerInWsl(opts: SpawnWslWorkerOptions): ChildProcess {
  const args = ['-d', opts.distro]
  if (wslCdFlagSupported(opts.distro)) {
    // The user's node + login PATH (see wsl-env.ts): same runtime as their terminal, and the
    // agent's bash tool sees the same tools.
    args.push('--cd', opts.wslCwd, '--', ...wslNodeCommand(opts.distro, opts.workerWslPath))
  } else {
    const [bin, ...rest] = wslNodeCommand(opts.distro, opts.workerWslPath)
    args.push('--', 'bash', '-lc', 'cd -- "$1" && shift && exec "$@"', 'bash', opts.wslCwd, bin, ...rest)
  }
  const env: Record<string, string> = {
    ...process.env,
    [WORKER_STDIO_ENV]: '1',
    [WORKER_WSL_DISTRO_ENV]: opts.distro,
  }
  // wsl.exe 默认不把 Windows 环境变量传入 WSL 进程，必须经 WSLENV 白名单显式声明。
  const inherited = process.env.WSLENV
  const toPass = [WORKER_STDIO_ENV, WORKER_WSL_DISTRO_ENV]
  const extra = toPass.filter((v) => !inherited?.split(':').some((e) => e.split('/')[0] === v))
  if (inherited === undefined || extra.length) {
    env.WSLENV = extra.length ? [inherited, ...extra].filter(Boolean).join(':') : ''
  }
  return spawn('wsl.exe', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env,
  })
}
