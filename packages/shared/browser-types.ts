/** Built-in browser: wire types and pure helpers shared by Renderer and Main. */

export type BrowserEngineId = 'electron' | 'stealth'

export interface BrowserTabInfo {
  tabId: string
  engine: BrowserEngineId
  profileId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  openedBy: 'user' | { sessionKey: string }
}

export type BrowserEvent =
  | { type: 'tab-updated'; tab: BrowserTabInfo }
  | { type: 'tab-closed'; tabId: string }
  | { type: 'tab-focused'; tabId: string | null }
  | { type: 'download'; fileName: string; savePath: string; state: 'completed' | 'cancelled' | 'interrupted' }
  /** Shortcut pressed while the page itself had focus (the Renderer never sees those keys). */
  | { type: 'shortcut'; action: 'focus-address' | 'new-tab' | 'close-tab' }

export interface BrowserViewBounds {
  tabId: string
  /** Viewport placeholder rect in Renderer client coordinates (CSS px as reported by getBoundingClientRect). */
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export const BROWSER_EVENT_CHANNEL = 'ipc:browser-event'

export const DEFAULT_ELECTRON_PROFILE_ID = 'default-electron'

export const BROWSER_SEARCH_ENGINES = {
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  baidu: 'https://www.baidu.com/s?wd=',
} as const

export type BrowserSearchEngine = keyof typeof BROWSER_SEARCH_ENGINES

export const BROWSER_SEARCH_ENGINE_IDS = Object.keys(BROWSER_SEARCH_ENGINES) as BrowserSearchEngine[]

export const BROWSER_SEARCH_URL = BROWSER_SEARCH_ENGINES.bing

export function browserSearchUrl(engine: unknown): string {
  return typeof engine === 'string' && engine in BROWSER_SEARCH_ENGINES
    ? BROWSER_SEARCH_ENGINES[engine as BrowserSearchEngine]
    : BROWSER_SEARCH_URL
}

const LOCAL_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/|$)/i

/**
 * Address bar input → URL to load. Explicit http(s) URLs pass through; host-like input gets a
 * scheme (http for loopback and bare IPs, https otherwise); anything else becomes a search.
 */
export function normalizeAddressInput(raw: string, searchUrl: string = BROWSER_SEARCH_URL): string {
  const input = raw.trim()
  if (!input) return 'about:blank'
  if (/^https?:\/\//i.test(input)) return input
  if (/^about:blank$/i.test(input)) return 'about:blank'
  if (!/\s/.test(input)) {
    if (LOCAL_HOST_RE.test(input) || IPV4_RE.test(input)) return `http://${input}`
    if (DOMAIN_RE.test(input)) return `https://${input}`
  }
  return searchUrl + encodeURIComponent(input)
}

/** Only web pages may load in the built-in browser; `chrome:`, `file:`, `javascript:` etc. are refused. */
export function isAllowedBrowserUrl(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Schemes handed to the OS instead of being loaded (mail clients, chat apps, ...). */
export function isExternalProtocolUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return ['mailto:', 'tel:', 'sms:', 'magnet:'].includes(protocol)
  } catch {
    return false
  }
}

/** navigator.languages-style list without duplicates (Electron can repeat the base language). */
export function dedupeLanguages(languages: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const lang of languages) {
    const key = lang.trim()
    if (!key || seen.has(key.toLowerCase())) continue
    seen.add(key.toLowerCase())
    out.push(key)
  }
  return out
}

/**
 * Accept-Language for the session, shaped like Chrome's: each region variant followed by its
 * base once, e.g. ['zh-CN', 'zh', 'en-US'] → ['zh-CN', 'zh', 'en-US', 'en'] (header "zh-CN,zh;q=0.9,...").
 * This only affects request headers; navigator.languages in Electron pages repeats the base
 * language (["zh-CN","zh","zh"]) regardless, a known JS-side difference we do not patch.
 */
export function browserAcceptLanguages(preferred: readonly string[]): string[] {
  const expanded: string[] = []
  for (const lang of preferred) {
    expanded.push(lang)
    const base = lang.split('-')[0]
    if (base && base !== lang) expanded.push(base)
  }
  const out = dedupeLanguages(expanded)
  return out.length > 0 ? out : ['en-US', 'en']
}

/** Chrome UA for the given Chromium major version on the current platform (no Electron/app tokens). */
export function chromeUserAgent(chromeMajor: string, platform: string): string {
  const os =
    platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
}

/**
 * Sec-CH-UA value: the brands Electron reports to JS plus "Google Chrome", in the same order,
 * so the header matches what Chrome sends. JS-side navigator.userAgentData is left untouched.
 */
export function chromeSecChUa(original: string | undefined, chromeMajor: string): string {
  const brands = (original ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (brands.some((b) => /"Google Chrome"/.test(b))) return brands.join(', ')
  const base = brands.length > 0 ? brands : ['"Not;A=Brand";v="8"', `"Chromium";v="${chromeMajor}"`]
  return [...base, `"Google Chrome";v="${chromeMajor}"`].join(', ')
}

/** Sec-CH-UA-Platform value for a Node platform id. */
export function chromeSecChUaPlatform(platform: string): string {
  if (platform === 'win32') return '"Windows"'
  if (platform === 'darwin') return '"macOS"'
  return '"Linux"'
}

/**
 * Low-entropy UA client hints Chrome sends on every https request. Electron drops them once the
 * UA is overridden, and a Chrome UA without them is itself a tell; add or fix them here.
 */
export function withChromeClientHints(
  url: string,
  headers: Record<string, string>,
  chromeMajor: string,
  platform: string,
): Record<string, string> {
  if (!url.startsWith('https://')) return headers
  const out = { ...headers }
  const find = (name: string) => Object.keys(out).find((k) => k.toLowerCase() === name)
  const ua = find('sec-ch-ua')
  out[ua ?? 'sec-ch-ua'] = chromeSecChUa(ua ? out[ua] : undefined, chromeMajor)
  if (!find('sec-ch-ua-mobile')) out['sec-ch-ua-mobile'] = '?0'
  if (!find('sec-ch-ua-platform')) out['sec-ch-ua-platform'] = chromeSecChUaPlatform(platform)
  return out
}
