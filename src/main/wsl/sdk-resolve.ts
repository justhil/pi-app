/**
 * Resolving the global `@earendil-works/pi-coding-agent` package inside a WSL
 * distro. Runs a bash probe inside the distro, then validates entry resolution
 * over the UNC view (`\\wsl.localhost\<distro>\...`) while returning the
 * WSL-native path for the worker process to import.
 */

import { join, posix } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { wslPathToWindows } from '@shared/wsl-path'
import { resolvePackageEntryPath } from '../global-sdk-resolve.js'
import {
  runWslDistroAsync,
  wslDefaultShellSync,
  wslHomeDirSync,
} from './wsl-exec.js'

const PKG = '@earendil-works/pi-coding-agent'

const PROBE_SCRIPT = [
  'PKG="__PKG__"',
  'seen=""',
  'try() {',
  '  local r="$1"',
  '  [ -n "$r" ] || return 0',
  '  [ -f "$r/package.json" ] || return 0',
  '  case " $seen " in *" $r "*) return 0;; esac',
  '  seen="$seen $r"',
  '  printf "%s\\n" "$r"',
  '}',
  'if command -v npm >/dev/null 2>&1; then',
  '  out="$(npm list -g "$PKG" --json --depth=0 2>/dev/null || true)"',
  '  p="$(printf "%s" "$out" | node -e \'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const d=j.dependencies&&j.dependencies[process.argv[1]];if(d&&d.path)console.log(d.path)}catch{}})\' "$PKG" 2>/dev/null || true)"',
  '  try "$p"',
  '  for pre in "$(npm prefix -g 2>/dev/null || true)" "$(npm root -g 2>/dev/null || true)"; do',
  '    [ -n "$pre" ] || continue',
  '    try "$pre/node_modules/$PKG"',
  '    try "$pre/lib/node_modules/$PKG"',
  '  done',
  'fi',
  'if command -v pi >/dev/null 2>&1; then',
  '  for sh in $(command -v pi 2>/dev/null); do',
  '    real="$(readlink -f "$sh" 2>/dev/null || printf "%s" "$sh")"',
  '    case "$real" in',
  '      *node_modules/@earendil-works/pi-coding-agent/*)',
  '        root="${real%%/node_modules/@earendil-works/pi-coding-agent/*}"',
  '        try "$root/node_modules/@earendil-works/pi-coding-agent"',
  '        ;;',
  '    esac',
  '    dir="$(dirname "$real")"',
  '    try "$dir/node_modules/$PKG"',
  '    try "$dir/../node_modules/$PKG"',
  '  done',
  'fi',
  'if [ -n "$HOME" ]; then',
  '  try "$HOME/.npm-global/lib/node_modules/$PKG"',
  '  for d in "$HOME/.nvm/versions/node/"*/lib/node_modules/"$PKG"; do',
  '    [ -e "$d" ] && try "$d"',
  '  done',
  'fi',
  'try "/usr/local/lib/node_modules/$PKG"',
  'try "/usr/lib/node_modules/$PKG"',
  '',
].join('\n')

function resolveProbeScript(): string {
  return PROBE_SCRIPT.replace('__PKG__', PKG)
}

/**
 * Write the probe script into the distro's `~/.pi-desktop/` so `wsl.exe` runs
 * the file directly instead of passing the multi-line script (with nested
 * quotes) through its command line, which corrupts it on Windows.
 */
function writeProbeScriptToWsl(distro: string, home: string, script: string): string | null {
  try {
    const dirWsl = `${home}/.pi-desktop`
    const dirUnc = wslPathToWindows(distro, dirWsl)
    mkdirSync(dirUnc, { recursive: true })
    const probeUnc = join(dirUnc, 'probe.sh')
    writeFileSync(probeUnc, script, 'utf-8')
    return `${dirWsl}/probe.sh`
  } catch {
    return null
  }
}

export interface WslSdkResolution {
  packageRoot: string
  entryPath: string
  version: string | null
}

const WSL_SDK_RESOLVE_TTL_MS = 60_000
let wslSdkResolveCache: {
  at: number
  distro: string
  value: WslSdkResolution | null
} | null = null

export function invalidateWslSdkResolveCache(): void {
  wslSdkResolveCache = null
}

/**
 * 断言发行版内可解析到 pi-coding-agent，返回其解析结果。
 * 供 switchTo 与 verifySelectedSdk 共用，避免两套错误文案漂移。
 */
export async function assertWslSdkAvailable(
  distro: string,
  opts?: { refresh?: boolean },
): Promise<WslSdkResolution> {
  const sdk = await resolveWslActiveSdk(distro, opts)
  if (!sdk) {
    throw new Error('WSL 发行版内未检测到 pi-coding-agent，无法切换到全局版本')
  }
  return sdk
}

/** Read the version from the distro package.json via the UNC view. */
function readWslSdkVersion(uncRoot: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(uncRoot, 'package.json'), 'utf-8'))
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * Find the pi-coding-agent install inside the distro and return its
 * WSL-native entry path (importable by the worker).
 *
 * 探测要跑 wsl.exe bash，秒级开销；worker fork / 状态读取会高频调用，
 * 结果按 distro 做 60s TTL 缓存，避免每次 fork 都重跑探测脚本。
 */
export async function resolveWslActiveSdk(
  distro: string,
  opts?: { refresh?: boolean },
): Promise<WslSdkResolution | null> {
  const now = Date.now()
  if (
    !opts?.refresh &&
    wslSdkResolveCache &&
    wslSdkResolveCache.distro === distro &&
    now - wslSdkResolveCache.at < WSL_SDK_RESOLVE_TTL_MS
  ) {
    return wslSdkResolveCache.value
  }

  const home = wslHomeDirSync(distro)
  if (!home) return null

  const shell = wslDefaultShellSync(distro)
  const scriptPath = writeProbeScriptToWsl(distro, home, resolveProbeScript())
  if (!scriptPath) return null

  const result = await runWslDistroAsync(distro, [shell, scriptPath], { timeout: 30000 })
  const candidates = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/'))

  let resolved: WslSdkResolution | null = null
  for (const wslRoot of candidates) {
    const uncRoot = wslPathToWindows(distro, wslRoot)
    const entryUnc = resolvePackageEntryPath(uncRoot)
    if (!entryUnc) continue
    const rel = entryUnc
      .slice(uncRoot.length)
      .replace(/^[/\\]+/, '')
      .replace(/\\/g, '/')
    // WSL 原生路径必须用正斜杠：Windows 的 path.join 会产出 \root\...，
    // 导致 worker 端 isAbsolute 判假并被当作包名 import。
    const entryPath = posix.join(wslRoot, rel)
    resolved = { packageRoot: wslRoot, entryPath, version: readWslSdkVersion(uncRoot) }
    break
  }

  wslSdkResolveCache = { at: now, distro, value: resolved }
  return resolved
}
