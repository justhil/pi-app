import { stat } from 'fs/promises'
import { join, resolve } from 'path'
import { probeExtensions, type ExtensionProbeResult } from '../extension-compat/extension-probe'
import { getActiveAgentDir, getActiveDesktopDir, getActiveHomeDir } from '../extension-compat/active-dirs'
import { sessionPreviewProcess } from './session-preview-process'
import { awaitWslVm } from './wsl/wsl-env'

/**
 * Extension probing reads every installed extension's sources — ~300ms of synchronous fs. On the
 * main process that stalls every other IPC reply (session switches, settings, git), and the slash
 * catalog + right-panel catalog ask for it at startup and on each switch. So:
 *  - run it in the preview utility process (async; main stays responsive), sync only as fallback;
 *  - share one in-flight probe per key and reuse the result while its inputs are unchanged
 *    (settings / extension roots mtimes), with a TTL for in-place source edits.
 * Callers get a deep copy: some decorate the probes in place.
 */

const TTL_MS = 60_000

type Entry = { key: string; at: number; promise: Promise<ExtensionProbeResult[]>; settled: boolean }
let entry: Entry | null = null

// Async: in WSL mode these are \\wsl.localhost paths, where even a stat is a 9p round trip.
async function mtimeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
  }
}

function normalizeCwd(cwd: string): string {
  const abs = resolve(cwd)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

async function cacheKey(cwd: string): Promise<string> {
  const agentDir = getActiveAgentDir()
  const desktopDir = getActiveDesktopDir()
  const mtimes = await Promise.all(
    [
      join(agentDir, 'settings.json'),
      join(cwd, '.pi', 'settings.json'),
      join(cwd, '.pi', 'extensions'),
      join(agentDir, 'extensions'),
      join(agentDir, 'git'),
      join(cwd, '.pi', 'desktop', 'adapters'),
      join(desktopDir, 'adapters'),
    ].map(mtimeOf),
  )
  return [normalizeCwd(cwd), agentDir, ...mtimes].join('|')
}

async function probeOffThread(cwd: string): Promise<ExtensionProbeResult[]> {
  try {
    // Local utility process even in WSL mode (dirs are then UNC paths): the probe only reads
    // files, and doing it here kept the main thread busy for ~2s per call over \\wsl.localhost.
    return await sessionPreviewProcess.probeExtensions({
      cwd,
      agentDir: getActiveAgentDir(),
      desktopDir: getActiveDesktopDir(),
      homeDir: getActiveHomeDir(),
    })
  } catch (error) {
    console.warn('[extension-probe] preview probe failed, probing in main:', error)
  }
  return probeExtensions(cwd)
}

const clone = (list: ExtensionProbeResult[]): ExtensionProbeResult[] => structuredClone(list)

/** Probe results for `cwd`; `fresh` bypasses the cache (settings pages that must show edits). */
export async function probeExtensionsShared(cwd: string, options?: { fresh?: boolean }): Promise<ExtensionProbeResult[]> {
  await awaitWslVm()
  const key = await cacheKey(cwd)
  const now = Date.now()
  const reusable =
    entry &&
    entry.key === key &&
    (!entry.settled || (!options?.fresh && now - entry.at < TTL_MS))
  if (!reusable) {
    const next: Entry = { key, at: now, settled: false, promise: probeOffThread(cwd) }
    next.promise.then(
      () => {
        next.settled = true
        next.at = Date.now()
      },
      () => {
        if (entry === next) entry = null
      },
    )
    entry = next
  }
  return clone(await entry!.promise)
}

/** Forget cached probes (after the desktop installs/toggles extensions). */
export function invalidateExtensionProbeCache(): void {
  entry = null
}

/** Start probing early (e.g. right after launch) so the first catalog request finds it warm. */
export function prewarmExtensionProbe(cwd: string): void {
  void probeExtensionsShared(cwd).catch(() => {})
}
