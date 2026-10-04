// Local browsers and their profiles. Adapted from Orca (MIT, see NOTICE.md) and extended with
// Chromium, Vivaldi and Opera on Linux and Firefox's XDG location (~/.config/mozilla/firefox).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type BrowserFamily = 'chromium-based' | 'firefox'

export interface ChromiumBrowserDef {
  id: string
  label: string
  keychainService: string
  keychainAccount: string
  /** Linux secret-tool "application" attribute used by newer builds. */
  linuxApplication: string
  macRoot?: string
  winRoot?: string
  linuxRoot?: string
}

export const CHROMIUM_BROWSERS: ChromiumBrowserDef[] = [
  { id: 'chrome', label: 'Google Chrome', keychainService: 'Chrome Safe Storage', keychainAccount: 'Chrome', linuxApplication: 'chrome', macRoot: 'Google/Chrome', winRoot: 'Google/Chrome/User Data', linuxRoot: 'google-chrome' },
  { id: 'edge', label: 'Microsoft Edge', keychainService: 'Microsoft Edge Safe Storage', keychainAccount: 'Microsoft Edge', linuxApplication: 'microsoft-edge', macRoot: 'Microsoft Edge', winRoot: 'Microsoft/Edge/User Data', linuxRoot: 'microsoft-edge' },
  { id: 'brave', label: 'Brave', keychainService: 'Brave Safe Storage', keychainAccount: 'Brave', linuxApplication: 'brave', macRoot: 'BraveSoftware/Brave-Browser', winRoot: 'BraveSoftware/Brave-Browser/User Data', linuxRoot: 'BraveSoftware/Brave-Browser' },
  { id: 'chromium', label: 'Chromium', keychainService: 'Chromium Safe Storage', keychainAccount: 'Chromium', linuxApplication: 'chromium', macRoot: 'Chromium', winRoot: 'Chromium/User Data', linuxRoot: 'chromium' },
  { id: 'vivaldi', label: 'Vivaldi', keychainService: 'Vivaldi Safe Storage', keychainAccount: 'Vivaldi', linuxApplication: 'vivaldi', macRoot: 'Vivaldi', winRoot: 'Vivaldi/User Data', linuxRoot: 'vivaldi' },
  { id: 'opera', label: 'Opera', keychainService: 'Opera Safe Storage', keychainAccount: 'Opera', linuxApplication: 'opera', macRoot: 'com.operasoftware.Opera', winRoot: '../Roaming/Opera Software/Opera Stable', linuxRoot: 'opera' },
  { id: 'arc', label: 'Arc', keychainService: 'Arc Safe Storage', keychainAccount: 'Arc', linuxApplication: 'arc', macRoot: 'Arc/User Data' },
]

export interface BrowserProfile {
  name: string
  directory: string
  cookiesPath: string
}

export interface BrowserSource {
  /** `<browser id>` — profiles are chosen separately. */
  id: string
  label: string
  family: BrowserFamily
  profiles: BrowserProfile[]
}

export function browserRootPath(def: ChromiumBrowserDef, env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | null {
  const home = env.HOME ?? env.USERPROFILE ?? ''
  if (platform === 'darwin') return def.macRoot ? join(home, 'Library', 'Application Support', def.macRoot) : null
  if (platform === 'win32') return def.winRoot && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, def.winRoot) : null
  if (!def.linuxRoot) return null
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), def.linuxRoot)
}

/** Profile dirs come from external metadata and become path segments. */
export function isSafeProfileDirectory(directory: string): boolean {
  return directory.length > 0 && directory !== '.' && !/[\0/\\]/.test(directory) && !directory.includes('..')
}

/** Cookies live in `<profile>/Network/Cookies` (Chrome 96+) or `<profile>/Cookies`. */
function chromiumCookiesPath(root: string, directory: string): string | null {
  for (const p of [join(root, directory, 'Network', 'Cookies'), join(root, directory, 'Cookies')]) if (existsSync(p)) return p
  return null
}

function chromiumProfiles(root: string): BrowserProfile[] {
  const named: { name: string; directory: string }[] = []
  try {
    const cache = JSON.parse(readFileSync(join(root, 'Local State'), 'utf-8'))?.profile?.info_cache
    if (cache && typeof cache === 'object') {
      for (const [dir, info] of Object.entries(cache)) if (isSafeProfileDirectory(dir)) named.push({ name: (info as { name?: string })?.name || dir, directory: dir })
    }
  } catch {
    // no Local State: try the default profile
  }
  if (!named.length) named.push({ name: 'Default', directory: 'Default' })
  return named.flatMap((p) => {
    const cookiesPath = chromiumCookiesPath(root, p.directory)
    return cookiesPath ? [{ ...p, cookiesPath }] : []
  })
}

/** Firefox keeps profiles in ~/.mozilla/firefox, or ~/.config/mozilla/firefox on newer Linux builds. */
export function firefoxRoots(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? ''
  if (platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')]
  if (platform === 'win32') return env.APPDATA ? [join(env.APPDATA, 'Mozilla', 'Firefox', 'Profiles')] : []
  return [join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'mozilla', 'firefox'), join(home, '.mozilla', 'firefox')]
}

function firefoxProfiles(root: string): BrowserProfile[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isSafeProfileDirectory(e.name) && existsSync(join(root, e.name, 'cookies.sqlite')))
      .map((e) => ({ name: e.name.includes('.') ? e.name.split('.').slice(1).join('.') : e.name, directory: e.name, cookiesPath: join(root, e.name, 'cookies.sqlite') }))
      .sort((a, b) => Number(b.name.includes('default-release')) - Number(a.name.includes('default-release')))
  } catch {
    return []
  }
}

/** Every local browser with at least one profile that has a cookie store. */
export function detectBrowserSources(): BrowserSource[] {
  const out: BrowserSource[] = []
  for (const def of CHROMIUM_BROWSERS) {
    const root = browserRootPath(def)
    if (!root || !existsSync(root)) continue
    const profiles = chromiumProfiles(root)
    if (profiles.length) out.push({ id: def.id, label: def.label, family: 'chromium-based', profiles })
  }
  const ff = firefoxRoots().flatMap(firefoxProfiles)
  if (ff.length) out.push({ id: 'firefox', label: 'Firefox', family: 'firefox', profiles: ff })
  return out
}
