import { randomUUID } from 'node:crypto'
import { shell, WebContentsView, type BrowserWindow, type Input } from 'electron'
import {
  BROWSER_EVENT_CHANNEL,
  DEFAULT_ELECTRON_PROFILE_ID,
  isAllowedBrowserUrl,
  isDevOrigin,
  isExternalProtocolUrl,
  normalizeBrowserSessionKey,
  sessionHasBrowserTabs,
  type BrowserAgentStep,
  type BrowserDownloadInfo,
  type BrowserEvent,
  type BrowserLogEntry,
  type BrowserTabInfo,
  type BrowserViewBounds,
  type ElementDescriptor,
  type PageContextResult,
} from '@shared/browser-types'
import { configStore } from '../config-store'
import {
  configureBrowserSession,
  partitionForProfile,
  peekDownloadManager,
  userAgentForSessionUrl,
} from './electron-session'
import { FRAMEWORK_SOURCE } from './page-scripts'
import { computeViewBounds } from './view-layout'
import { BrowserToolError } from './agent/errors'
import { Pointer } from './agent/input'
import { adoptAgentSessionTabs, forgetBrowserTab, type AgentBrowserHost } from './agent/tools'
import { ElectronPageEngine } from './engines/electron'
import type { PageEngine } from './engines/types'

interface Tab {
  info: BrowserTabInfo
  view: WebContentsView | null
  logs: BrowserLogEntry[]
  engine: PageEngine | null
  pointer: Pointer | null
  /** Serializes agent actions on this tab. */
  queue: Promise<unknown>
  lastActiveAt: number
  agentBusy: boolean
}

interface ClosedTabRecord {
  url: string
  title: string
  favicon?: string
  profileId: string
  closedAt: number
}

const DEFAULT_VIEW_SIZE = { width: 1280, height: 800 }
const LOG_LIMIT = 200
const PAGE_SCRIPT_TIMEOUT_MS = 2000
const MAX_CLOSED_HISTORY = 20
/** Auto-sleep background tabs idle for 15 minutes to save Chromium memory/CPU. */
const AUTO_SLEEP_IDLE_MS = 15 * 60 * 1000
const SLEEP_SWEEP_INTERVAL_MS = 2 * 60 * 1000

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

export class BrowserHost implements AgentBrowserHost {
  private readonly tabs = new Map<string, Tab>()
  private readonly closedHistory: ClosedTabRecord[] = []
  private activeTabId: string | null = null
  private activeSessionKey: string | null = null
  private readonly activeTabBySession = new Map<string, string>()
  private readonly sleepTimer: NodeJS.Timeout

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    this.sleepTimer = setInterval(() => this.sweepIdleTabs(), SLEEP_SWEEP_INTERVAL_MS)
    this.sleepTimer.unref?.()
  }

  pageProcessIds(): number[] {
    return [...this.tabs.values()]
      .filter((t) => t.view && !t.view.webContents.isDestroyed())
      .map((t) => t.view!.webContents.getOSProcessId())
  }

  list(): { tabs: BrowserTabInfo[]; activeTabId: string | null } {
    return { tabs: [...this.tabs.values()].map((t) => t.info), activeTabId: this.activeTabId }
  }

  hasSessionTabs(sessionKey: string | null | undefined): boolean {
    return sessionHasBrowserTabs([...this.tabs.values()].map((t) => t.info), sessionKey)
  }

  private createViewForTab(profileId: string, tabLogs: () => BrowserLogEntry[]): {
    view: WebContentsView
    engine: ElectronPageEngine
    pointer: Pointer
  } {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) throw new Error('browser: main window unavailable')
    configureBrowserSession(profileId, {
      emit: (e) => this.emit(e),
      onNetworkProblem: (webContentsId, entry) => {
        for (const t of this.tabs.values()) {
          if (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === webContentsId) {
            pushLog(t, entry)
          }
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
        backgroundThrottling: true,
      },
    })
    view.setVisible(false)
    const content = win.getContentBounds()
    view.setBounds({
      x: 0,
      y: 0,
      width: Math.min(DEFAULT_VIEW_SIZE.width, Math.max(320, content.width - 16)),
      height: Math.min(DEFAULT_VIEW_SIZE.height, Math.max(240, content.height - 90)),
    })
    win.contentView.addChildView(view)

    const engine = new ElectronPageEngine(view.webContents, tabLogs, {
      cdp: () => configStore.get('browserAgentCdp') !== 'off',
      screenOrigin: () => {
        const w = this.getWindow()
        if (!w || w.isDestroyed()) return { x: 0, y: 0 }
        const c = w.getContentBounds()
        const v = view.getBounds()
        return { x: c.x + v.x, y: c.y + v.y }
      },
    })
    return { view, engine, pointer: new Pointer(engine) }
  }

  openTab(
    opts: {
      url?: string
      profileId?: string
      focus?: boolean
      openedBy?: BrowserTabInfo['openedBy']
      sessionKey?: string
      pinned?: boolean
    } = {},
  ): BrowserTabInfo {
    const profileId = opts.profileId || DEFAULT_ELECTRON_PROFILE_ID

    // User-opened tabs are workspace-persistent ('user') so switching chats never hides them.
    // Agent-opened tabs keep their sessionKey attribution while still remaining visible.
    const openedBy: BrowserTabInfo['openedBy'] =
      opts.openedBy !== undefined
        ? opts.openedBy === 'user'
          ? 'user'
          : { sessionKey: normalizeBrowserSessionKey(opts.openedBy.sessionKey) }
        : 'user'

    const info: BrowserTabInfo = {
      tabId: randomUUID(),
      engine: 'electron',
      profileId,
      url: 'about:blank',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      muted: false,
      audible: false,
      sleeping: false,
      loadError: null,
      openedBy,
      ...(opts.pinned ? { pinned: true } : {}),
    }

    const tab: Tab = {
      info,
      view: null,
      logs: [],
      engine: null,
      pointer: null,
      queue: Promise.resolve(),
      lastActiveAt: Date.now(),
      agentBusy: false,
    }
    const created = this.createViewForTab(profileId, () => tab.logs)
    tab.view = created.view
    tab.engine = created.engine
    tab.pointer = created.pointer

    this.tabs.set(info.tabId, tab)
    this.wire(tab)
    this.emit({ type: 'tab-updated', tab: info })

    const ownerKey = openedBy !== 'user' ? openedBy.sessionKey : this.activeSessionKey
    if (ownerKey) this.activeTabBySession.set(ownerKey, info.tabId)
    const shouldFocus = opts.focus !== undefined ? opts.focus : true
    if (shouldFocus) this.focusTab(info.tabId)

    const url = opts.url && isAllowedBrowserUrl(opts.url) ? opts.url : 'about:blank'
    if (url !== 'about:blank') void this.load(tab, url)
    return info
  }

  duplicateTab(tabId: string): BrowserTabInfo | null {
    const tab = this.tabs.get(tabId)
    if (!tab) return null
    return this.openTab({
      url: tab.info.url,
      profileId: tab.info.profileId,
      openedBy: 'user',
      focus: true,
    })
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    if (tab.info.url && tab.info.url !== 'about:blank' && isAllowedBrowserUrl(tab.info.url)) {
      this.closedHistory.push({
        url: tab.info.url,
        title: tab.info.title,
        favicon: tab.info.favicon,
        profileId: tab.info.profileId,
        closedAt: Date.now(),
      })
      if (this.closedHistory.length > MAX_CLOSED_HISTORY) this.closedHistory.shift()
    }
    this.tabs.delete(tabId)
    for (const [k, id] of this.activeTabBySession) if (id === tabId) this.activeTabBySession.delete(k)
    forgetBrowserTab(tabId)
    const win = this.getWindow()
    if (tab.view) {
      if (win && !win.isDestroyed()) win.contentView.removeChildView(tab.view)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    this.emit({ type: 'tab-closed', tabId })
    if (this.activeTabId === tabId) {
      const remaining = [...this.tabs.keys()]
      const next = remaining.at(-1) ?? null
      this.activeTabId = null
      if (next) this.focusTab(next)
      else this.emit({ type: 'tab-focused', tabId: null })
    }
  }

  reopenClosedTab(): BrowserTabInfo | null {
    const rec = this.closedHistory.pop()
    if (!rec) return null
    return this.openTab({ url: rec.url, profileId: rec.profileId, openedBy: 'user', focus: true })
  }

  reorderTabs(order: string[]): BrowserTabInfo[] {
    const next = new Map<string, Tab>()
    for (const id of order) {
      const tab = this.tabs.get(id)
      if (tab) next.set(id, tab)
    }
    for (const [id, tab] of this.tabs) {
      if (!next.has(id)) next.set(id, tab)
    }
    this.tabs.clear()
    for (const [id, tab] of next) this.tabs.set(id, tab)
    return [...this.tabs.values()].map((t) => t.info)
  }

  setMuted(tabId: string, muted: boolean): BrowserTabInfo | null {
    const tab = this.tabs.get(tabId)
    if (!tab) return null
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.setAudioMuted(muted)
    }
    tab.info = { ...tab.info, muted }
    this.emit({ type: 'tab-updated', tab: tab.info })
    return tab.info
  }

  /** Put a background tab to sleep: frees its Chromium renderer process while preserving URL/title/favicon. */
  sleepTab(tabId: string): BrowserTabInfo | null {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.info.sleeping || tab.agentBusy) return tab?.info ?? null
    if (tabId === this.activeTabId) return tab.info
    const win = this.getWindow()
    if (tab.view) {
      if (win && !win.isDestroyed()) win.contentView.removeChildView(tab.view)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
      tab.view = null
      tab.engine = null
      tab.pointer = null
    }
    tab.info = { ...tab.info, sleeping: true, loading: false, audible: false }
    this.emit({ type: 'tab-updated', tab: tab.info })
    return tab.info
  }

  /** Wake a sleeping tab on demand by rebuilding its WebContentsView and restoring its URL. */
  private ensureAwake(tab: Tab): WebContentsView {
    tab.lastActiveAt = Date.now()
    if (tab.view && !tab.view.webContents.isDestroyed()) return tab.view
    const created = this.createViewForTab(tab.info.profileId, () => tab.logs)
    tab.view = created.view
    tab.engine = created.engine
    tab.pointer = created.pointer
    if (tab.info.muted) tab.view.webContents.setAudioMuted(true)
    tab.info = { ...tab.info, sleeping: false }
    this.wire(tab)
    this.emit({ type: 'tab-updated', tab: tab.info })
    if (tab.info.url && tab.info.url !== 'about:blank' && isAllowedBrowserUrl(tab.info.url)) {
      void this.load(tab, tab.info.url)
    }
    return tab.view
  }

  private sweepIdleTabs(): void {
    const now = Date.now()
    for (const tab of this.tabs.values()) {
      if (
        tab.info.tabId !== this.activeTabId &&
        !tab.info.sleeping &&
        !tab.info.pinned &&
        !tab.info.audible &&
        !tab.agentBusy &&
        tab.info.url !== 'about:blank' &&
        now - tab.lastActiveAt >= AUTO_SLEEP_IDLE_MS
      ) {
        this.sleepTab(tab.info.tabId)
      }
    }
  }

  focusTab(tabId: string | null, opts?: { window?: boolean; sessionKey?: string }): void {
    if (tabId === null) {
      if (this.activeTabId) this.tabs.get(this.activeTabId)?.view?.setVisible(false)
      this.activeTabId = null
      this.emit({ type: 'tab-focused', tabId: null })
      return
    }
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.ensureAwake(tab)
    const targetSession = opts?.sessionKey
      ? normalizeBrowserSessionKey(opts.sessionKey)
      : this.activeSessionKey
    if (targetSession) this.activeTabBySession.set(targetSession, tabId)
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId)
      if (prev) {
        prev.view?.setVisible(false)
        prev.lastActiveAt = Date.now()
      }
    }
    this.activeTabId = tabId
    tab.lastActiveAt = Date.now()
    this.emit({ type: 'tab-focused', tabId })
  }

  setSession(sessionKey: string | null): { activeTabId: string | null } {
    const nextKey = normalizeBrowserSessionKey(sessionKey)
    this.activeSessionKey = nextKey
    // Keep the currently active tab alive & visible across chat switches unless none is active.
    if (this.activeTabId && this.tabs.has(this.activeTabId)) {
      return { activeTabId: this.activeTabId }
    }
    const remembered = this.activeTabBySession.get(nextKey)
    const nextTabId =
      (remembered && this.tabs.has(remembered) ? remembered : null) ??
      [...this.tabs.keys()].at(-1) ??
      null
    if (nextTabId) this.focusTab(nextTabId)
    return { activeTabId: this.activeTabId }
  }

  pinTab(tabId: string, pinned: boolean): BrowserTabInfo | null {
    const tab = this.tabs.get(tabId)
    if (!tab) return null
    const nextInfo: BrowserTabInfo = {
      ...tab.info,
      ...(pinned ? { pinned: true } : {}),
    }
    if (!pinned) delete nextInfo.pinned
    tab.info = nextInfo
    this.emit({ type: 'tab-updated', tab: tab.info })
    return tab.info
  }

  adoptSessionTabs(fromSessionKey: string, toSessionKey: string): void {
    const from = normalizeBrowserSessionKey(fromSessionKey)
    const to = normalizeBrowserSessionKey(toSessionKey)
    if (!from || !to || from === to) return
    for (const tab of this.tabs.values()) {
      if (tab.info.openedBy !== 'user' && normalizeBrowserSessionKey(tab.info.openedBy.sessionKey) === from) {
        tab.info = { ...tab.info, openedBy: { sessionKey: to } }
        this.emit({ type: 'tab-updated', tab: tab.info })
      }
    }
    const remembered = this.activeTabBySession.get(from)
    if (remembered) {
      if (!this.activeTabBySession.has(to)) this.activeTabBySession.set(to, remembered)
      this.activeTabBySession.delete(from)
    }
    if (this.activeSessionKey === from) this.activeSessionKey = to
    adoptAgentSessionTabs(from, to)
  }

  async navigate(tabId: string, op: BrowserNavigateOp): Promise<void> {
    const tab = this.requireTab(tabId)
    const view = this.ensureAwake(tab)
    const wc = view.webContents
    if ('url' in op) {
      if (!isAllowedBrowserUrl(op.url)) throw new Error('browser: only http(s) pages can be opened')
      await this.load(tab, op.url)
      return
    }
    if (op.history === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (op.history === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (op.history === 'reload') {
      tab.info = { ...tab.info, loadError: null }
      this.emit({ type: 'tab-updated', tab: tab.info })
      wc.reload()
    } else if (op.history === 'stop') wc.stop()
  }

  setViewBounds(bounds: BrowserViewBounds): void {
    const win = this.getWindow()
    const tab = this.tabs.get(bounds.tabId)
    if (!win || win.isDestroyed() || !tab) return
    if (!bounds.visible) {
      tab.view?.setVisible(false)
      return
    }
    if (!tab.view || tab.view.webContents.isDestroyed()) return
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
    const zoom = bounds.pageZoom ?? 1
    if (Math.abs(tab.view.webContents.getZoomFactor() - zoom) > 0.001) {
      tab.view.webContents.setZoomFactor(zoom)
    }
    tab.view.setVisible(true)
  }

  hideAll(): void {
    for (const tab of this.tabs.values()) tab.view?.setVisible(false)
  }

  async capture(tabId: string): Promise<string | null> {
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.view || tab.info.url === 'about:blank' || tab.view.webContents.isDestroyed()) return null
    const image = await tab.view.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`
  }

  async inspectPoint(
    tabId: string,
    x: number,
    y: number,
    deep = false,
    ancestorSteps = 0,
  ): Promise<ElementDescriptor | null> {
    const tab = this.requireTab(tabId)
    const view = this.ensureAwake(tab)
    const wc = view.webContents
    const zoom = wc.getZoomFactor() || 1
    const cssX = num(x / zoom)
    const cssY = num(y / zoom)
    const raw = await tab.engine!.run<ElementDescriptor | null>(
      `__piBrowser.inspectAtPoint(${cssX}, ${cssY}, ${Math.max(0, Math.floor(ancestorSteps || 0))})`,
    )
    const found =
      raw && {
        ...raw,
        rect: {
          x: raw.rect.x * zoom,
          y: raw.rect.y * zoom,
          width: raw.rect.width * zoom,
          height: raw.rect.height * zoom,
        },
      }
    if (!found || !deep || !isDevOrigin(wc.getURL())) return found
    try {
      const extra = (await withTimeout(
        wc.executeJavaScript(`(${FRAMEWORK_SOURCE})(${cssX}, ${cssY})`),
        PAGE_SCRIPT_TIMEOUT_MS,
      )) as { components: string[]; sourceHints: string[] } | null
      if (extra) {
        const sourceHints = [
          ...extra.sourceHints,
          ...found.sourceHints.filter((h) => !extra.sourceHints.includes(h)),
        ].slice(0, 4)
        return { ...found, sourceHints, ...(extra.components.length ? { components: extra.components } : {}) }
      }
    } catch (error) {
      console.warn('[browser] framework source lookup failed:', (error as Error)?.message)
    }
    return found
  }

  async pageContext(tabId: string, maxChars = 60_000): Promise<PageContextResult> {
    const tab = this.requireTab(tabId)
    this.ensureAwake(tab)
    return tab.engine!.run<PageContextResult>(`__piBrowser.pageContext(${num(maxChars)})`)
  }

  agentTab(tabId: string): { info: BrowserTabInfo; engine: PageEngine; pointer: Pointer } {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new BrowserToolError('browser_no_tab', 'the tab was closed; call browser_tabs action "list"')
    this.ensureAwake(tab)
    tab.engine!.cdpTab?.()
    return { info: tab.info, engine: tab.engine!, pointer: tab.pointer! }
  }

  readonly kind = 'builtin' as const

  notify(event: BrowserEvent): void {
    this.emit(event)
  }

  downloads(): BrowserDownloadInfo[] {
    return peekDownloadManager()?.list() ?? []
  }

  runOnTab<T>(tabId: string, action: string, work: () => Promise<T>): Promise<T> {
    const tab = this.requireTab(tabId)
    const run = tab.queue.catch(() => undefined).then(async () => {
      const stepId = randomUUID()
      tab.agentBusy = true
      tab.lastActiveAt = Date.now()
      this.emit({ type: 'agent-action', tabId, action })
      const startStep: BrowserAgentStep = { id: stepId, tabId, action, status: 'running', at: Date.now() }
      this.emit({ type: 'agent-step', step: startStep })
      try {
        const result = await work()
        this.emit({
          type: 'agent-step',
          step: { id: stepId, tabId, action, status: 'done', at: Date.now() },
        })
        return result
      } catch (err) {
        this.emit({
          type: 'agent-step',
          step: { id: stepId, tabId, action, status: 'error', at: Date.now() },
        })
        throw err
      } finally {
        tab.agentBusy = false
        tab.lastActiveAt = Date.now()
        this.emit({ type: 'agent-action', tabId, action: null })
      }
    })
    tab.queue = run
    return run
  }

  logs(tabId: string, max = 30): BrowserLogEntry[] {
    return this.requireTab(tabId).logs.slice(-max)
  }

  find(tabId: string, text: string, opts: { forward: boolean; findNext: boolean }): void {
    const wc = this.tabs.get(tabId)?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    if (!text) {
      wc.stopFindInPage('clearSelection')
      this.emit({ type: 'find-result', tabId, active: 0, matches: 0 })
      return
    }
    wc.findInPage(text, { forward: opts.forward, findNext: !opts.findNext })
  }

  stopFind(tabId: string): void {
    const wc = this.tabs.get(tabId)?.view?.webContents
    if (wc && !wc.isDestroyed()) wc.stopFindInPage('keepSelection')
  }

  scroll(tabId: string, x: number, y: number, deltaY: number): void {
    const tab = this.requireTab(tabId)
    const wc = this.ensureAwake(tab).webContents
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: num(x),
      y: num(y),
      deltaX: 0,
      deltaY: -num(deltaY),
      canScroll: true,
      hasPreciseScrollingDeltas: true,
    })
  }

  shutdown(): void {
    clearInterval(this.sleepTimer)
    for (const tabId of [...this.tabs.keys()]) this.closeTab(tabId)
    this.activeTabId = null
  }

  private requireTab(tabId: string): Tab {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`browser: unknown tab ${tabId}`)
    return tab
  }

  private async load(tab: Tab, url: string): Promise<void> {
    const view = this.ensureAwake(tab)
    tab.info = { ...tab.info, url, loading: true, loadError: null }
    this.emit({ type: 'tab-updated', tab: tab.info })
    try {
      await view.webContents.loadURL(url)
    } catch (error) {
      console.warn('[browser] load failed:', url, (error as Error)?.message)
    }
  }

  private wire(tab: Tab): void {
    const view = tab.view
    if (!view) return
    const wc = view.webContents
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
      else if (isAllowedBrowserUrl(url)) {
        this.openTab({ url, profileId: tab.info.profileId, openedBy: tab.info.openedBy })
      }
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
    const syncUaForUrl = (url: string) => {
      if (wc.isDestroyed()) return
      const targetUa = userAgentForSessionUrl(wc.session, url)
      if (wc.getUserAgent() !== targetUa) wc.setUserAgent(targetUa)
    }
    wc.on('did-start-loading', () => update({ loading: true }))
    wc.on('did-stop-loading', () => update({ loading: false }))
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return // -3 is ERR_ABORTED
      update({
        loading: false,
        loadError: { code: errorCode, description: errorDescription || 'ERR_FAILED', url: validatedURL || tab.info.url },
      })
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      const icon = favicons?.find((u) => typeof u === 'string' && /^https?:|^data:image\//i.test(u))
      if (icon && icon !== tab.info.favicon) update({ favicon: icon })
    })
    wc.on('media-started-playing', () => update({ audible: true }))
    wc.on('media-paused', () => update({ audible: false }))
    wc.on('did-navigate', (_e, url) => {
      update({ loadError: null })
      if (typeof url === 'string' && url.includes('accounts.google.com') && url.includes('signin/rejected')) {
        void wc.session.cookies
          .get({ domain: 'accounts.google.com' })
          .then((cookies) =>
            Promise.all(
              cookies
                .filter((c) => c.name === '__Host-GAPS' || c.name === 'OTZ')
                .map((c) =>
                  wc.session.cookies.remove(
                    `https://${(c.domain ?? 'accounts.google.com').replace(/^\./, '')}${c.path ?? '/'}`,
                    c.name,
                  ),
                ),
            ),
          )
          .catch(() => {})
      }
    })
    wc.on('did-navigate-in-page', () => update())
    wc.on('page-title-updated', () => update())
    wc.on('console-message', (details) => {
      if (details.level !== 'error' && details.level !== 'warning') return
      const source = details.sourceId ? `${details.sourceId}:${details.lineNumber}` : undefined
      pushLog(tab, {
        at: Date.now(),
        kind: 'console',
        level: details.level,
        message: details.message,
        ...(source ? { source } : {}),
      })
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        tab.logs = []
        tab.info = { ...tab.info, loadError: null, favicon: undefined }
        syncUaForUrl(details.url)
      }
    })
    wc.on('did-redirect-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) syncUaForUrl(details.url)
    })
    wc.on('found-in-page', (_e, result) => {
      this.emit({
        type: 'find-result',
        tabId: tab.info.tabId,
        active: result.activeMatchOrdinal ?? 0,
        matches: result.matches ?? 0,
      })
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
      else if (action !== 'back' && action !== 'forward') this.emit({ type: 'shortcut', action })
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

type ShortcutAction =
  | 'focus-address'
  | 'new-tab'
  | 'close-tab'
  | 'reopen-tab'
  | 'toggle-stage'
  | 'annotate'
  | 'find'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'reload'
  | 'back'
  | 'forward'

export function shortcutAction(
  input: Pick<Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'shift'>,
): ShortcutAction | null {
  if (input.type !== 'keyDown') return null
  const mod = process.platform === 'darwin' ? input.meta : input.control
  const key = input.key.toLowerCase()
  if (mod && !input.alt && input.shift && key === 'a') return 'annotate'
  if (mod && !input.alt && input.shift && key === 't') return 'reopen-tab'
  if (mod && !input.alt && input.shift && key === 'b') return 'toggle-stage'
  if (mod && !input.alt && !input.shift) {
    if (key === 'l') return 'focus-address'
    if (key === 't') return 'new-tab'
    if (key === 'w') return 'close-tab'
    if (key === 'r') return 'reload'
    if (key === 'f') return 'find'
    if (key === '=' || key === '+') return 'zoom-in'
    if (key === '-') return 'zoom-out'
    if (key === '0') return 'zoom-reset'
  }
  if (mod && !input.alt && input.shift && (key === '+' || key === '=')) return 'zoom-in'
  if (key === 'f5' && !mod) return 'reload'
  if (input.alt && !mod && key === 'arrowleft') return 'back'
  if (input.alt && !mod && key === 'arrowright') return 'forward'
  return null
}

let host: BrowserHost | null = null

export function getBrowserHost(getWindow: () => BrowserWindow | null): BrowserHost {
  if (!host) host = new BrowserHost(getWindow)
  return host
}

export function peekBrowserHost(): BrowserHost | null {
  return host
}
