import { randomUUID } from 'node:crypto'
import { shell, WebContentsView, type BrowserWindow, type Input } from 'electron'
import {
  BROWSER_EVENT_CHANNEL,
  DEFAULT_ELECTRON_PROFILE_ID,
  isAllowedBrowserUrl,
  isDevOrigin,
  isExternalProtocolUrl,
  type BrowserEvent,
  type BrowserLogEntry,
  type BrowserTabInfo,
  type BrowserViewBounds,
  type ElementDescriptor,
  type PageContextResult,
} from '@shared/browser-types'
import { configureBrowserSession, partitionForProfile } from './electron-session'
import { FRAMEWORK_SOURCE, INSPECT_AT_POINT, PAGE_CONTEXT } from './page-scripts'
import { computeViewBounds } from './view-layout'
import { BrowserToolError, Pointer } from './browser-agent'

interface Tab {
  info: BrowserTabInfo
  view: WebContentsView
  logs: BrowserLogEntry[]
  pointer: Pointer
  /** Serializes agent actions on this tab. */
  queue: Promise<unknown>
}

/** Layout size for tabs the user has not shown yet (agent-opened tabs still need a viewport). */
const DEFAULT_VIEW_SIZE = { width: 1280, height: 800 }

/** Isolated world shared by all host page scripts; pages cannot see its globals. */
const SCRIPT_WORLD = 1999
const LOG_LIMIT = 200
/** A page blocked by alert()/confirm() never answers; fail fast instead of hanging the UI. */
const PAGE_SCRIPT_TIMEOUT_MS = 2000

export class BrowserDialogPendingError extends Error {
  constructor() {
    super('browser_dialog_pending: the page is waiting on a dialog')
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BrowserDialogPendingError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const num = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0)

export type BrowserNavigateOp = { url: string } | { history: 'back' | 'forward' | 'reload' | 'stop' }

/**
 * Built-in browser host (engine E). Tabs are WebContentsViews stacked on the main window;
 * only the tab whose placeholder the Renderer reports as visible is shown. No preload,
 * sandboxed, no debugger — the user browses; agent tools arrive in a later task.
 */
export class BrowserHost {
  private readonly tabs = new Map<string, Tab>()
  private activeTabId: string | null = null

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  list(): { tabs: BrowserTabInfo[]; activeTabId: string | null } {
    return { tabs: [...this.tabs.values()].map((t) => t.info), activeTabId: this.activeTabId }
  }

  openTab(opts: { url?: string; profileId?: string; focus?: boolean; openedBy?: BrowserTabInfo['openedBy'] } = {}): BrowserTabInfo {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) throw new Error('browser: main window unavailable')
    const profileId = opts.profileId || DEFAULT_ELECTRON_PROFILE_ID
    configureBrowserSession(profileId, {
      emit: (e) => this.emit(e),
      onNetworkProblem: (webContentsId, entry) => {
        for (const t of this.tabs.values()) {
          if (!t.view.webContents.isDestroyed() && t.view.webContents.id === webContentsId) pushLog(t, entry)
        }
      },
    })

    const view = new WebContentsView({
      webPreferences: {
        partition: partitionForProfile(profileId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
      },
    })
    view.setVisible(false)
    view.setBounds({ x: 0, y: 0, ...DEFAULT_VIEW_SIZE })
    win.contentView.addChildView(view)

    const info: BrowserTabInfo = {
      tabId: randomUUID(),
      engine: 'electron',
      profileId,
      url: 'about:blank',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      openedBy: opts.openedBy ?? 'user',
    }
    const tab: Tab = { info, view, logs: [], pointer: new Pointer(view.webContents), queue: Promise.resolve() }
    this.tabs.set(info.tabId, tab)
    this.wire(tab)
    this.emit({ type: 'tab-updated', tab: info })
    if (opts.focus !== false) this.focusTab(info.tabId)

    const url = opts.url && isAllowedBrowserUrl(opts.url) ? opts.url : 'about:blank'
    if (url !== 'about:blank') void this.load(tab, url)
    return info
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.tabs.delete(tabId)
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    this.emit({ type: 'tab-closed', tabId })
    if (this.activeTabId === tabId) {
      const next = [...this.tabs.keys()].pop() ?? null
      this.activeTabId = null
      if (next) this.focusTab(next)
      else this.emit({ type: 'tab-focused', tabId: null })
    }
  }

  focusTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return
    if (this.activeTabId && this.activeTabId !== tabId) this.tabs.get(this.activeTabId)?.view.setVisible(false)
    this.activeTabId = tabId
    this.emit({ type: 'tab-focused', tabId })
  }

  async navigate(tabId: string, op: BrowserNavigateOp): Promise<void> {
    const tab = this.requireTab(tabId)
    const wc = tab.view.webContents
    if ('url' in op) {
      if (!isAllowedBrowserUrl(op.url)) throw new Error('browser: only http(s) pages can be opened')
      await this.load(tab, op.url)
      return
    }
    if (op.history === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (op.history === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (op.history === 'reload') wc.reload()
    else if (op.history === 'stop') wc.stop()
  }

  /** Placeholder rect from the Renderer; shows the active tab there or hides it. */
  setViewBounds(bounds: BrowserViewBounds): void {
    const win = this.getWindow()
    const tab = this.tabs.get(bounds.tabId)
    if (!win || win.isDestroyed() || !tab) return
    const [width, height] = win.getContentSize()
    const rect =
      bounds.tabId === this.activeTabId && tab.info.url !== 'about:blank'
        ? computeViewBounds(bounds, win.webContents.getZoomFactor(), { width, height })
        : null
    if (!rect) {
      tab.view.setVisible(false)
      return
    }
    tab.view.setBounds(rect)
    tab.view.setVisible(true)
  }

  hideAll(): void {
    for (const tab of this.tabs.values()) tab.view.setVisible(false)
  }

  /** JPEG data URL of the active page, used as a stand-in while overlays cover the view. */
  async capture(tabId: string): Promise<string | null> {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.info.url === 'about:blank' || tab.view.webContents.isDestroyed()) return null
    const image = await tab.view.webContents.capturePage()
    return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`
  }

  /** Element under a viewport point (isolated world). `deep` adds framework source clues on dev origins. */
  async inspectPoint(tabId: string, x: number, y: number, deep = false): Promise<ElementDescriptor | null> {
    const wc = this.requireTab(tabId).view.webContents
    const code = `(${INSPECT_AT_POINT})(${num(x)}, ${num(y)})`
    const found = (await withTimeout(wc.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code }]), PAGE_SCRIPT_TIMEOUT_MS)) as ElementDescriptor | null
    if (!found || !deep || !isDevOrigin(wc.getURL())) return found
    try {
      // Main world, dev origins only, once per click: React fiber / Vue instance live on DOM expandos.
      const extra = (await withTimeout(wc.executeJavaScript(`(${FRAMEWORK_SOURCE})(${num(x)}, ${num(y)})`), PAGE_SCRIPT_TIMEOUT_MS)) as
        | { components: string[]; sourceHints: string[] }
        | null
      if (extra) {
        const sourceHints = [...extra.sourceHints, ...found.sourceHints.filter((h) => !extra.sourceHints.includes(h))].slice(0, 4)
        return { ...found, sourceHints, ...(extra.components.length ? { components: extra.components } : {}) }
      }
    } catch (error) {
      console.warn('[browser] framework source lookup failed:', (error as Error)?.message)
    }
    return found
  }

  async pageContext(tabId: string, maxChars = 60_000): Promise<PageContextResult> {
    const wc = this.requireTab(tabId).view.webContents
    const code = `(${PAGE_CONTEXT})(${num(maxChars)})`
    return (await withTimeout(wc.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code }]), PAGE_SCRIPT_TIMEOUT_MS)) as PageContextResult
  }

  /** Tab the agent means: the given id, else the tab shown in the panel, else the newest. */
  resolveTabId(tabId?: string): string {
    if (tabId) {
      if (!this.tabs.has(tabId)) throw new BrowserToolError('browser_no_tab', `no tab ${tabId}; call browser_tabs to list tabs`)
      return tabId
    }
    const id = this.activeTabId ?? [...this.tabs.keys()].pop()
    if (!id) throw new BrowserToolError('browser_no_tab', 'no tab is open; call browser_tabs with action "new"')
    return id
  }

  agentTab(tabId: string): { info: BrowserTabInfo; wc: Electron.WebContents; pointer: Pointer } {
    const tab = this.requireTab(tabId)
    return { info: tab.info, wc: tab.view.webContents, pointer: tab.pointer }
  }

  /** Run agent work on a tab one at a time; tells the panel which action is running. */
  runOnTab<T>(tabId: string, action: string, work: () => Promise<T>): Promise<T> {
    const tab = this.requireTab(tabId)
    const run = tab.queue.catch(() => undefined).then(async () => {
      this.emit({ type: 'agent-action', tabId, action })
      try {
        return await work()
      } finally {
        this.emit({ type: 'agent-action', tabId, action: null })
      }
    })
    tab.queue = run
    return run
  }

  /** PNG of the page even while the tab is hidden; scaled down to at most `maxWidth`. */
  async screenshotPng(tabId: string, maxWidth = 1280): Promise<{ png: Buffer; width: number; height: number }> {
    const wc = this.requireTab(tabId).view.webContents
    let image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
    if (image.isEmpty()) throw new BrowserToolError('browser_timeout', 'the page has not painted yet')
    const size = image.getSize()
    if (size.width > maxWidth) image = image.resize({ width: maxWidth, quality: 'good' })
    const out = image.getSize()
    return { png: image.toPNG(), width: out.width, height: out.height }
  }

  logs(tabId: string, max = 30): BrowserLogEntry[] {
    return this.requireTab(tabId).logs.slice(-max)
  }

  /** Real wheel input at a viewport point (DOM deltaY > 0 scrolls down). */
  scroll(tabId: string, x: number, y: number, deltaY: number): void {
    const wc = this.requireTab(tabId).view.webContents
    wc.sendInputEvent({ type: 'mouseWheel', x: num(x), y: num(y), deltaX: 0, deltaY: -num(deltaY), canScroll: true })
  }

  shutdown(): void {
    for (const tabId of [...this.tabs.keys()]) this.closeTab(tabId)
    this.activeTabId = null
  }

  private requireTab(tabId: string): Tab {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`browser: unknown tab ${tabId}`)
    return tab
  }

  private async load(tab: Tab, url: string): Promise<void> {
    tab.info = { ...tab.info, url, loading: true }
    this.emit({ type: 'tab-updated', tab: tab.info })
    try {
      await tab.view.webContents.loadURL(url)
    } catch (error) {
      // Aborted / failed loads still update state through did-fail-load; only log here.
      console.warn('[browser] load failed:', url, (error as Error)?.message)
    }
  }

  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    const update = (patch: Partial<BrowserTabInfo> = {}) => {
      if (wc.isDestroyed()) return
      tab.info = {
        ...tab.info,
        url: wc.getURL() || tab.info.url,
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        ...patch,
      }
      this.emit({ type: 'tab-updated', tab: tab.info })
    }

    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalProtocolUrl(url)) void shell.openExternal(url)
      else if (isAllowedBrowserUrl(url)) this.openTab({ url, profileId: tab.info.profileId })
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (isAllowedBrowserUrl(url)) return
      event.preventDefault()
      if (isExternalProtocolUrl(url)) void shell.openExternal(url)
    })
    wc.on('will-redirect', (event, url) => {
      if (!isAllowedBrowserUrl(url)) event.preventDefault()
    })
    wc.on('did-start-loading', () => update({ loading: true }))
    wc.on('did-stop-loading', () => update({ loading: false }))
    wc.on('did-navigate', () => update())
    wc.on('did-navigate-in-page', () => update())
    wc.on('page-title-updated', () => update())
    wc.on('console-message', (details) => {
      if (details.level !== 'error' && details.level !== 'warning') return
      const source = details.sourceId ? `${details.sourceId}:${details.lineNumber}` : undefined
      pushLog(tab, { at: Date.now(), kind: 'console', level: details.level, message: details.message, ...(source ? { source } : {}) })
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) tab.logs = []
    })
    wc.on('render-process-gone', (_e, details) => {
      console.warn('[browser] page renderer gone:', details.reason)
      update({ loading: false })
    })
    wc.on('before-input-event', (event, input) => {
      const action = shortcutAction(input)
      if (!action) return
      event.preventDefault()
      if (action === 'reload') wc.reload()
      else if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      else if (action === 'focus-address' || action === 'new-tab' || action === 'close-tab' || action === 'annotate') {
        this.emit({ type: 'shortcut', action })
      }
    })
  }

  private emit(event: BrowserEvent): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(BROWSER_EVENT_CHANNEL, event)
  }
}

function pushLog(tab: Tab, entry: BrowserLogEntry): void {
  tab.logs.push(entry)
  if (tab.logs.length > LOG_LIMIT) tab.logs.splice(0, tab.logs.length - LOG_LIMIT)
}

type ShortcutAction = 'focus-address' | 'new-tab' | 'close-tab' | 'annotate' | 'reload' | 'back' | 'forward'

/** Keys the page would swallow but users expect the browser chrome to handle. */
export function shortcutAction(input: Pick<Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'shift'>): ShortcutAction | null {
  if (input.type !== 'keyDown') return null
  const mod = process.platform === 'darwin' ? input.meta : input.control
  const key = input.key.toLowerCase()
  if (mod && !input.alt && input.shift && key === 'a') return 'annotate'
  if (mod && !input.alt && !input.shift) {
    if (key === 'l') return 'focus-address'
    if (key === 't') return 'new-tab'
    if (key === 'w') return 'close-tab'
    if (key === 'r') return 'reload'
  }
  if (key === 'f5' && !mod) return 'reload'
  if (input.alt && !mod && key === 'arrowleft') return 'back'
  if (input.alt && !mod && key === 'arrowright') return 'forward'
  return null
}

let host: BrowserHost | null = null

/** Created on first use, so the experiment being off means no browser objects exist in Main. */
export function getBrowserHost(getWindow: () => BrowserWindow | null): BrowserHost {
  if (!host) host = new BrowserHost(getWindow)
  return host
}

export function peekBrowserHost(): BrowserHost | null {
  return host
}

