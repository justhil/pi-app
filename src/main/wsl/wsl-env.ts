/**
 * The user's real environment inside a WSL distro, resolved once and reused everywhere.
 *
 * Before this, every consumer probed differently: `bash -lc` for home/shell, the distro's default
 * shell (non-login) for the SDK probe, and a bare `node` with wsl.exe's minimal PATH for the
 * worker. So the node that ran the worker could differ from the one the user's terminal (and
 * `npm i -g`) uses, and the agent's bash tool lacked PATH entries like ~/.local/bin or nvm.
 * Home/shell lookups were also synchronous wsl.exe calls on the main process with a 60s TTL —
 * seconds of UI freeze whenever the distro VM had to boot.
 *
 * Now: one `wsl.exe -- sh -s` call runs the user's login shell (interactive first, like a
 * terminal; then login-only; then plain) and prints marked KEY=value lines. The result is kept in
 * memory and persisted, so synchronous callers read it instantly on later launches; it is
 * refreshed in the background at startup and on demand from settings.
 */

import { isValidWslDistroName, runWslAsync } from './wsl-exec.js'

type PersistKey = 'wslEnvCache' | 'wslSdkCache'
/** Injected by the main process (config store); memory-only when unbound (tests, utilities). */
let persistence: { get: (key: PersistKey) => unknown; set: (key: PersistKey, value: unknown) => void } | null = null

export function bindWslPersistence(p: typeof persistence): void {
  persistence = p
}

export function readWslPersisted<T>(key: PersistKey): T | undefined {
  try {
    return persistence?.get(key) as T | undefined
  } catch {
    return undefined
  }
}

export function writeWslPersisted(key: PersistKey, value: unknown): void {
  try {
    persistence?.set(key, value)
  } catch {
    /* persistence is best effort */
  }
}

export interface WslEnv {
  distro: string
  home: string
  /** Absolute login shell path, e.g. /usr/bin/zsh. */
  shell: string
  /** PATH as seen by the user's login shell. */
  path: string
  node: string | null
  nodeVersion: string | null
  npm: string | null
  pi: string | null
  git: string | null
  /** How the environment was captured (interactive-login is the terminal-equivalent). */
  mode: 'interactive-login' | 'login' | 'plain'
  /** Whether `wsl.exe --cd` works on this host. */
  cdSupported: boolean
  resolvedAt: number
}

const BEGIN = '__PI_ENV_BEGIN__'
const END = '__PI_ENV_END__'

// Each rc may print noise; only lines between the markers are parsed. `timeout` guards rc files
// that wait on input; stdin is /dev/null for the same reason.
const CAPTURE_SCRIPT = [
  'sh_bin="${SHELL:-/bin/sh}"',
  `emit='printf "\\n${BEGIN}\\n"; printf "HOME=%s\\n" "$HOME"; printf "PATH=%s\\n" "$PATH"; printf "NODE=%s\\n" "$(command -v node)"; printf "NODEV=%s\\n" "$(node --version 2>/dev/null)"; printf "NPM=%s\\n" "$(command -v npm)"; printf "PI=%s\\n" "$(command -v pi)"; printf "GIT=%s\\n" "$(command -v git)"; printf "${END}\\n"'`,
  'run() { if command -v timeout >/dev/null 2>&1; then timeout 10 "$@"; else "$@"; fi; }',
  `out="$(run "$sh_bin" -ilc "$emit" </dev/null 2>/dev/null)"; mode=interactive-login`,
  `case "$out" in *${END}*) ;; *) out="$(run "$sh_bin" -lc "$emit" </dev/null 2>/dev/null)"; mode=login;; esac`,
  `case "$out" in *${END}*) ;; *) out="$(sh -c "$emit" </dev/null 2>/dev/null)"; mode=plain;; esac`,
  `printf "%s\\n" "$out" | sed -n "/${BEGIN}/,/${END}/p"`,
  'printf "SHELL=%s\\nMODE=%s\\n" "$sh_bin" "$mode"',
  '',
].join('\n')

export function parseWslEnvOutput(distro: string, stdout: string, cdSupported: boolean): WslEnv | null {
  const values = new Map<string, string>()
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq)
    if (!/^[A-Z]+$/.test(key)) continue
    values.set(key, line.slice(eq + 1).trim())
  }
  const home = values.get('HOME') || ''
  if (!home.startsWith('/')) return null
  const abs = (v: string | undefined) => (v && v.startsWith('/') ? v : null)
  const mode = values.get('MODE')
  return {
    distro,
    home,
    shell: abs(values.get('SHELL')) ?? '/bin/sh',
    path: values.get('PATH') || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    node: abs(values.get('NODE')),
    nodeVersion: values.get('NODEV')?.replace(/^v/, '') || null,
    npm: abs(values.get('NPM')),
    pi: abs(values.get('PI')),
    git: abs(values.get('GIT')),
    mode: mode === 'interactive-login' || mode === 'login' ? mode : 'plain',
    cdSupported,
    resolvedAt: Date.now(),
  }
}

const memory = new Map<string, WslEnv>()
const inflight = new Map<string, Promise<WslEnv | null>>()

function persisted(): Record<string, WslEnv> {
  const raw = readWslPersisted<Record<string, WslEnv>>('wslEnvCache')
  return raw && typeof raw === 'object' ? raw : {}
}

/** Last known environment (memory, then persisted). Never spawns — safe on hot/sync paths. */
export function getCachedWslEnv(distro: string): WslEnv | null {
  const hit = memory.get(distro)
  if (hit) return hit
  const stored = persisted()[distro]
  if (stored?.home) {
    memory.set(distro, stored)
    return stored
  }
  return null
}

function remember(env: WslEnv): void {
  memory.set(env.distro, env)
  writeWslPersisted('wslEnvCache', { ...persisted(), [env.distro]: env })
}

async function capture(distro: string): Promise<WslEnv | null> {
  // `--cd` must precede `--`; hosts without it fail fast, then we retry without.
  const withCd = await runWslAsync(['-d', distro, '--cd', '/', '--', 'sh', '-s'], {
    input: CAPTURE_SCRIPT,
    timeout: 45_000,
  })
  let env = parseWslEnvOutput(distro, withCd.stdout, true)
  if (!env) {
    const plain = await runWslAsync(['-d', distro, '--', 'sh', '-s'], { input: CAPTURE_SCRIPT, timeout: 45_000 })
    env = parseWslEnvOutput(distro, plain.stdout, false)
  }
  return env
}

/**
 * Resolve (or refresh) the distro environment. Concurrent callers share one wsl.exe run.
 * Without `force`, a cached environment is returned as-is.
 */
export function resolveWslEnv(distro: string, opts?: { force?: boolean }): Promise<WslEnv | null> {
  if (!isValidWslDistroName(distro)) return Promise.resolve(null)
  if (!opts?.force) {
    const cached = getCachedWslEnv(distro)
    if (cached) return Promise.resolve(cached)
  }
  const running = inflight.get(distro)
  if (running) return running
  const job = capture(distro)
    .then((env) => {
      if (env) remember(env)
      return env ?? getCachedWslEnv(distro)
    })
    .finally(() => inflight.delete(distro))
  inflight.set(distro, job)
  return job
}

/** Background refresh (startup / runtime switch): serve the cached value now, update for later. */
export function refreshWslEnvInBackground(distro: string): void {
  void resolveWslEnv(distro, { force: true }).catch(() => {})
}

let vmBoot: { distro: string; ready: Promise<void> } | null = null

/**
 * Start the distro VM without blocking (a stopped WSL2 VM takes seconds to boot). Main-process
 * code that reads \\wsl.localhost paths synchronously awaits `awaitWslVm()` first, so the boot
 * happens here instead of inside a synchronous fs call on the UI thread.
 */
export function startWslVm(distro: string): Promise<void> {
  if (vmBoot?.distro === distro) return vmBoot.ready
  const ready = runWslAsync(['-d', distro, '--', 'true'], { timeout: 60_000 }).then(() => undefined)
  vmBoot = { distro, ready }
  return ready
}

/** Resolves once the VM started by `startWslVm` is up (immediately when none was started). */
export function awaitWslVm(): Promise<void> {
  return vmBoot?.ready ?? Promise.resolve()
}

export function forgetWslEnv(distro?: string): void {
  if (distro) memory.delete(distro)
  else memory.clear()
}

/**
 * argv (after `--`) that runs `script` with the user's node and PATH. Falls back to a bare `node`
 * when the environment is unknown (first launch before the capture finished).
 */
export function wslNodeCommand(distro: string, script: string): string[] {
  const env = getCachedWslEnv(distro)
  if (!env?.node) return ['node', script]
  return ['env', `PATH=${env.path}`, env.node, script]
}
