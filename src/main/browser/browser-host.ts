import { randomUUID } from 'node:crypto'
import { shell, WebContentsView, type BrowserWindow, type Input } from 'electron'
import {
  BROWSER_EVENT_CHANNEL,
  DEFAULT_ELECTRON_PROFILE_ID,
  isAllowedBrowserUrl,
  isExternalProtocolUrl,
  type BrowserEvent,
  type BrowserTabInfo,
  type BrowserViewBounds,
} from '@shared/browser-types'
import { configureBrowserSession, partitionForProfile } from './electron-session'
import { computeViewBounds } from './view-layout'

interface Tab {
  info: BrowserTabInfo
  view: WebContentsView
}

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

  openTab(opts: { url?: string; profileId?: string; focus?: boolean } = {}): BrowserTabInfo {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) throw new Error('browser: main window unavailable')
    const profileId = opts.profileId || DEFAULT_ELECTRON_PROFILE_ID
    configureBrowserSession(profileId, (e) => this.emit(e))

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
      openedBy: 'user',
    }
    const tab: Tab = { info, view }
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
      else if (action === 'focus-address' || action === 'new-tab' || action === 'close-tab') {
        this.emit({ type: 'shortcut', action })
      }
    })
  }

  private emit(event: BrowserEvent): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(BROWSER_EVENT_CHANNEL, event)
  }
}

type ShortcutAction = 'focus-address' | 'new-tab' | 'close-tab' | 'reload' | 'back' | 'forward'

/** Keys the page would swallow but users expect the browser chrome to handle. */
export function shortcutAction(input: Pick<Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'shift'>): ShortcutAction | null {
  if (input.type !== 'keyDown') return null
  const mod = process.platform === 'darwin' ? input.meta : input.control
  const key = input.key.toLowerCase()
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

