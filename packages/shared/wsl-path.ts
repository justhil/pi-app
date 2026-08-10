/**
 * WSL path bridge.
 *
 * Translates between the Windows UNC view of a WSL distro filesystem
 * (`\\wsl.localhost\<distro>\...` / legacy `\\wsl$\<distro>\...`) and the
 * native WSL/Linux absolute paths used by the agent runtime running inside
 * WSL. Also handles the `/mnt/<drive>` auto-mount view of Windows drives.
 *
 * Shared by main, worker, and renderer so pool keys / session files stay
 * stable across the Windows <-> WSL boundary.
 */

export type WslDistroName = string

export const WSL_LOCALHOST_PREFIX = '\\\\wsl.localhost\\'
export const WSL_DOLLAR_PREFIX = '\\\\wsl$\\'

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

function isWindowsDriveAbs(p: string): boolean {
  return /^[a-zA-Z]:\//.test(p)
}

/** Detect a WSL UNC path: `\\wsl.localhost\<distro>\...` or legacy `\\wsl$\<distro>\...`. */
export function isWslWindowsPath(p: string | null | undefined): boolean {
  if (!p) return false
  const n = normalizeSlashes(p)
  return n.startsWith('//wsl.localhost/') || n.startsWith('//wsl$/')
}

/**
 * Extract the distro name from a WSL UNC path (case preserved as-is).
 * Returns null when `p` is not a WSL UNC path.
 */
export function wslWindowsPathDistro(p: string | null | undefined): string | null {
  if (!p) return null
  const n = normalizeSlashes(p).replace(/^\/+/, '')
  const first = n.indexOf('/')
  if (first < 0) return null
  const server = n.slice(0, first).toLowerCase()
  if (server !== 'wsl.localhost' && server !== 'wsl$') return null
  const rest = n.slice(first + 1)
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  return rest.slice(0, slash)
}

/**
 * Translate a WSL/Linux absolute path to the Windows view:
 *   `/home/u/x`              -> `\\wsl.localhost\<distro>\home\u\x`
 *   `/mnt/c/Users/u/x`       -> `C:\Users\u\x`
 * Returns `wslPath` unchanged when it cannot be translated (no distro for a
 * non-`/mnt` path, or already a Windows path).
 */
export function wslPathToWindows(
  distro: WslDistroName | null | undefined,
  wslPath: string | null | undefined,
): string {
  const p = (wslPath || '').trim()
  if (!p) return ''
  const n = normalizeSlashes(p)
  if (isWindowsDriveAbs(n) || isWslWindowsPath(n)) return p

  const mnt = n.match(/^\/mnt\/([a-zA-Z])(?:\/|$)/)
  if (mnt) {
    const drive = mnt[1].toUpperCase()
    const rest = n.slice(mnt[0].length)
    return `${drive}:\\${rest.split('/').filter(Boolean).join('\\')}`
  }
  if (!distro) return p
  const body = n.replace(/^\/+/, '').split('/').filter(Boolean).join('\\')
  if (!body) return p
  return `${WSL_LOCALHOST_PREFIX}${distro}\\${body}`
}

/**
 * Translate a Windows absolute path to the WSL/Linux view:
 *   `\\wsl.localhost\<distro>\home\u\x`  -> `/home/u/x`
 *   `C:\Users\u\x`                       -> `/mnt/c/Users/u/x`
 * Returns `winPath` unchanged when it is not a Windows absolute path.
 */
export function windowsPathToWsl(
  _distro: WslDistroName | null | undefined,
  winPath: string | null | undefined,
): string {
  const p = (winPath || '').trim()
  if (!p) return ''
  const n = normalizeSlashes(p)
  if (isWslWindowsPath(n)) {
    const rest = n.replace(/^\/\//, '').split('/')
    // rest = [server, distro, ...pathParts]
    if (rest.length < 3) return p
    return `/${rest.slice(2).join('/')}`
  }
  const drive = n.match(/^([a-zA-Z]):\/(.*)$/)
  if (drive) {
    const driveLetter = drive[1].toLowerCase()
    const rest = drive[2].split('/').filter(Boolean).join('/')
    return rest ? `/mnt/${driveLetter}/${rest}` : `/mnt/${driveLetter}`
  }
  return p
}

/** Canonical WSL UNC form: `\\wsl.localhost\<distro>\...` with forward slashes. */
export function normalizeWslWindowsPath(p: string | null | undefined): string {
  if (!p) return ''
  const distro = wslWindowsPathDistro(p)
  if (!distro) return p
  const n = normalizeSlashes(p)
  const parts = n.replace(/^\/\//, '').split('/')
  if (parts.length < 3) return p
  const body = parts.slice(2).join('/').replace(/\/+$/, '')
  return `//wsl.localhost/${distro}/${body}`
}

/**
 * Best-effort equality for WSL/UNC paths: normalizes slashes, distro case,
 * trailing slashes, and collapses repeated slashes before comparing.
 */
export function wslWindowsPathsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const norm = (v: string | null | undefined): string => {
    if (!v) return ''
    const d = wslWindowsPathDistro(v)
    if (!d) return v.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
    const prefix = `//wsl.localhost/${d}/`
    const rest = normalizeWslWindowsPath(v).slice(prefix.length)
    return `${prefix}${rest.replace(/\/+/g, '/').replace(/\/+$/, '')}`
  }
  return norm(a) === norm(b)
}
