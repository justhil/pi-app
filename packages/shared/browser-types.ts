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
  | { type: 'shortcut'; action: 'focus-address' | 'new-tab' | 'close-tab' | 'annotate' }
  /** The agent is acting on a tab (`action` null when it finished). */
  | { type: 'agent-action'; tabId: string; action: string | null }

export interface BrowserViewBounds {
  tabId: string
  /** Viewport placeholder rect in Renderer client coordinates (CSS px as reported by getBoundingClientRect). */
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  /**
   * Page zoom for the fixed-viewport mode: the view keeps the placeholder's size while the page
   * lays out at size/zoom CSS px (zoom < 1 shows a larger viewport scaled down). Default 1.
   */
  pageZoom?: number
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
 * Chromium's GREASE brand for a major version (user_agent_utils.cc: "Not" + c1 + "A" + c2 +
 * "Brand", version from a fixed list, both indexed by the major as seed).
 */
export function greaseBrand(chromeMajor: string): string {
  const seed = Number.parseInt(chromeMajor, 10) || 0
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
  const versions = ['8', '99', '24']
  return `"Not${chars[seed % chars.length]}A${chars[(seed + 1) % chars.length]}Brand";v="${versions[seed % versions.length]}"`
}

/**
 * Sec-CH-UA value that matches what the page sees in navigator.userAgentData (Electron reports
 * the Chromium brand list). Keeping header and JS identical matters more than claiming
 * "Google Chrome": a mismatch between the two is a stronger tell than either alone.
 */
export function chromeSecChUa(original: string | undefined, chromeMajor: string): string {
  const brands = (original ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((b) => b && !/"Google Chrome"/.test(b))
  return (brands.length > 0 ? brands : [greaseBrand(chromeMajor), `"Chromium";v="${chromeMajor}"`]).join(', ')
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

/** What the annotation picker knows about an element (built in the page's isolated world). */
export interface ElementDescriptor {
  tag: string
  id?: string
  classes: string[]
  role?: string
  name?: string
  text?: string
  selector: string
  /** Viewport CSS px of the element at inspection time. */
  rect: { x: number; y: number; width: number; height: number }
  styles: Record<string, string>
  /** Source location clues: DOM attributes (any page) or framework internals (dev origins only). */
  sourceHints: string[]
  /** Component names nearest-first, when a framework exposed them (dev origins only). */
  components?: string[]
}

export interface BrowserLogEntry {
  at: number
  kind: 'console' | 'network'
  level: 'error' | 'warning'
  message: string
  source?: string
}

export interface PageContextResult {
  title: string
  url: string
  text: string
  selection: string
  truncated: boolean
}

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\.0\.0\.0$/]

/**
 * Local development origins. Reading framework internals (React fiber, Vue instance) needs the
 * page's main world; we only do that here, and only when the user clicks an element.
 */
export function isDevOrigin(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  return PRIVATE_IPV4.some((re) => re.test(host))
}

export interface BrowserAnnotation {
  index: number
  comment: string
  element?: ElementDescriptor
  /** Area selection in viewport CSS px when no single element was picked. */
  area?: { x: number; y: number; width: number; height: number }
}

/** One-line human/agent-readable description of a picked element. */
export function describeElement(el: ElementDescriptor): string {
  const head = `<${el.tag}${el.id ? `#${el.id}` : ''}${el.classes.slice(0, 2).map((c) => `.${c}`).join('')}>`
  const label = el.name || el.text
  const where = [el.components?.[0], el.sourceHints[0]].filter(Boolean).join(' · ')
  return [head, label ? `"${label}"` : '', where ? `(${where})` : ''].filter(Boolean).join(' ')
}

export interface ComposerLabels {
  annotations: string
  logs: string
  noLogs: string
  area: string
  page: string
  noComment: string
}

export const DEFAULT_COMPOSER_LABELS: ComposerLabels = {
  annotations: 'Browser annotations',
  logs: 'Browser logs',
  noLogs: 'no errors or warnings',
  area: 'Area',
  page: 'Page',
  noComment: '(no comment)',
}

/** Text inserted into the composer for a batch of annotations; the user edits it before sending. */
export function formatAnnotationsForComposer(
  page: { title: string; url: string },
  items: BrowserAnnotation[],
  labels: ComposerLabels = DEFAULT_COMPOSER_LABELS,
): string {
  const lines = [`[${labels.annotations}] ${page.title || page.url} — ${page.url}`]
  for (const item of items) {
    const target = item.element
      ? describeElement(item.element)
      : item.area
        ? `${labels.area} ${Math.round(item.area.width)}×${Math.round(item.area.height)} @ (${Math.round(item.area.x)}, ${Math.round(item.area.y)})`
        : labels.page
    const selector = item.element ? ` [${item.element.selector}]` : ''
    lines.push(`${item.index}. ${target}${selector}: ${item.comment.trim() || labels.noComment}`)
  }
  return lines.join('\n')
}

/** Recent console / network problems as a compact text block. */
export function formatLogsForComposer(url: string, entries: BrowserLogEntry[], labels: ComposerLabels = DEFAULT_COMPOSER_LABELS): string {
  if (entries.length === 0) return `[${labels.logs}] ${url}: ${labels.noLogs}`
  const lines = [`[${labels.logs}] ${url}`]
  for (const e of entries) {
    const where = e.source ? ` (${e.source})` : ''
    lines.push(`- ${e.kind === 'network' ? 'network' : e.level}: ${e.message.replace(/\s+/g, ' ').slice(0, 300)}${where}`)
  }
  return lines.join('\n')
}

/** Selected page text quoted for the composer. */
export function formatSelectionForComposer(url: string, selection: string): string {
  const quoted = selection
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
  return `${quoted}\n> — ${url}\n`
}
