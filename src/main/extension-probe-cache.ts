import { stat } from 'fs/promises'
import { join, resolve } from 'path'
import { type ExtensionProbeResult } from '../extension-compat/extension-probe'
import { getActiveAgentDir, getActiveDesktopDir, getActiveHomeDir } from '../extension-compat/active-dirs'
import { sessionPreviewProcess } from './session-preview-process'
import { awaitWslVm } from './wsl/wsl-env'
import { prepareAdapterCatalog } from '../extension-compat/adapter-loader'

/**
 * Extension probing reads every installed extension's sources — ~300ms of synchronous fs. On the
 * main process that stalls every other IPC reply (session switches, settings, git), and the slash
 * catalog + right-panel catalog ask for it at startup and on each switch. So:
 *  - run it in the preview utility process (async; main stays responsive), failure returns an empty advisory result without a main-thread rescan;
 *  - share one in-flight probe per key and reuse the result while its inputs are unchanged
 *    (settings / extension roots mtimes), with a TTL for in-place source edits.
 * Callers get a deep copy: some decorate the probes in place.
 */

const TTL_MS = 60_000

type Entry = { key: string; at: number; promise: Promise<ExtensionProbeResult[]>; settled: boolean }
const entries = new Map<string, Entry>()

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
    console.warn('[extension-probe] preview probe failed:', error)
  }
  return []
}

const clone = (list: ExtensionProbeResult[]): ExtensionProbeResult[] => structuredClone(list)

/** Probe results for `cwd`; `fresh` bypasses the cache (settings pages that must show edits). */
export async function probeExtensionsShared(cwd: string, options?: { fresh?: boolean }): Promise<ExtensionProbeResult[]> {
  await awaitWslVm()
  await prepareAdapterCatalog(cwd)
  const key = await cacheKey(cwd)
  const now = Date.now()
  const entry = entries.get(key)
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
        if (entries.get(key) === next) entries.delete(key)
      },
    )
    entries.set(key, next)
  }
  return clone(await entries.get(key)!.promise)
}

/** Forget cached probes (after the desktop installs/toggles extensions). */
export function invalidateExtensionProbeCache(): void {
  entries.clear()
}

/** Start probing early (e.g. right after launch) so the first catalog request finds it warm. */
export function prewarmExtensionProbe(cwd: string): void {
  void probeExtensionsShared(cwd).catch(() => {})
}
