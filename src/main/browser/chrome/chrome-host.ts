// The user's Chrome as an AgentBrowserHost: tabs the agent opened in its Agent window plus tabs
// the user lent, each driven by a ChromePageEngine. The same executor runs on it as on the
// built-in browser.

import type { BrowserDownloadInfo, BrowserEvent, BrowserTabInfo } from '@shared/browser-types'
import { BrowserToolError } from '../agent/errors'
import { Pointer } from '../agent/input'
import { forgetBrowserTab, type AgentBrowserHost } from '../agent/tools'
import type { PageEngine } from '../engines/types'
import type { ChromeBridge } from './bridge'
import { ChromePageEngine } from './chrome-engine'

/** What the extension reports for a tab. */
interface ExtTab {
  tabId: number
  windowId: number
  url: string
  title: string
  loading: boolean
  active: boolean
  sessionKey: string | null
  borrowed: boolean
  agentWindow: boolean
}

interface Entry {
  info: BrowserTabInfo
  chromeTabId: number
  borrowed: boolean
  engine?: ChromePageEngine
  pointer?: Pointer
  queue: Promise<unknown>
}

const key = (chromeTabId: number) => `chrome-${chromeTabId}`

export class ChromeHost implements AgentBrowserHost {
  readonly kind = 'chrome' as const
  private tabs = new Map<string, Entry>()
  private downloadList = new Map<string, BrowserDownloadInfo>()

  constructor(
    private readonly bridge: ChromeBridge,
    private readonly emit: (event: BrowserEvent) => void,
  ) {
    bridge.on((event, p) => {
      if (event === 'tab.updated') this.upsert(p as ExtTab)
      else if (event === 'tab.removed') this.drop(key(p.tabId))
      else if (event === 'download.updated') this.downloadList.set(p.id, p as BrowserDownloadInfo)
      else if (event === 'hello') void this.resync()
    })
  }

  /** After a (re)connect: keep only tabs Chrome still has. */
  private async resync(): Promise<void> {
    const all = await this.bridge.call<ExtTab[]>('tabs.list').catch(() => null)
    if (!all) return
    const live = new Set(all.map((t) => key(t.tabId)))
    for (const k of [...this.tabs.keys()]) if (!live.has(k)) this.drop(k)
    for (const t of all) if (this.tabs.has(key(t.tabId))) this.upsert(t)
    const downloads = await this.bridge.call<BrowserDownloadInfo[]>('downloads.list').catch(() => [])
    for (const d of downloads) this.downloadList.set(d.id, d)
  }

  private upsert(t: ExtTab, sessionKey?: string): Entry | undefined {
    const k = key(t.tabId)
    const prev = this.tabs.get(k)
    const owner = sessionKey ?? t.sessionKey ?? (prev && prev.info.openedBy !== 'user' ? prev.info.openedBy.sessionKey : null)
    if (!owner) return undefined
    const info: BrowserTabInfo = {
      tabId: k,
      engine: 'chrome',
      profileId: 'chrome',
      url: t.url,
      title: t.title,
      loading: t.loading,
      canGoBack: false,
      canGoForward: false,
      openedBy: { sessionKey: owner },
    }
    const entry: Entry = prev ? { ...prev, info } : { info, chromeTabId: t.tabId, borrowed: t.borrowed, queue: Promise.resolve() }
    entry.engine?.update({ url: t.url, title: t.title, loading: t.loading })
    this.tabs.set(k, entry)
    return entry
  }

  private drop(k: string): void {
    const e = this.tabs.get(k)
    if (!e) return
    this.tabs.delete(k)
    forgetBrowserTab(k)
  }

  list(): { tabs: BrowserTabInfo[]; activeTabId: string | null } {
    return { tabs: [...this.tabs.values()].map((e) => e.info), activeTabId: null }
  }

  async openTab(opts: { url?: string; openedBy?: BrowserTabInfo['openedBy'] }): Promise<BrowserTabInfo> {
    const sessionKey = opts.openedBy && opts.openedBy !== 'user' ? opts.openedBy.sessionKey : 'agent'
    const t = await this.bridge.call<ExtTab>('tabs.create', { url: opts.url ?? 'about:blank', sessionKey })
    return this.upsert(t, sessionKey)!.info
  }

  closeTab(tabId: string): void {
    const e = this.tabs.get(tabId)
    if (!e) return
    if (e.borrowed) void this.giveBack(tabId)
    else void this.bridge.call('tabs.close', { tabId: e.chromeTabId }).catch(() => undefined)
    this.drop(tabId)
  }

  focusTab(tabId: string, opts: { window?: boolean } = {}): void {
    const e = this.tabs.get(tabId)
    if (e) void this.bridge.call('tabs.activate', { tabId: e.chromeTabId, focus: !!opts.window }).catch(() => undefined)
  }

  agentTab(tabId: string): { info: BrowserTabInfo; engine: PageEngine; pointer: Pointer } {
    const e = this.tabs.get(tabId)
    if (!e) throw new BrowserToolError('browser_no_tab', 'the Chrome tab is gone; call browser_tabs action "list"')
    if (!e.engine) {
      e.engine = new ChromePageEngine(this.bridge, e.chromeTabId, { url: e.info.url, title: e.info.title, loading: e.info.loading })
      e.pointer = new Pointer(e.engine)
    }
    return { info: e.info, engine: e.engine, pointer: e.pointer! }
  }

  /** One action at a time per tab; the tab is made the visible one in its window first (a
   * background tab does not render, so pages would stall). */
  runOnTab<T>(tabId: string, _action: string, work: () => Promise<T>): Promise<T> {
    const e = this.tabs.get(tabId)
    if (!e) return Promise.reject(new BrowserToolError('browser_no_tab', 'the Chrome tab is gone; call browser_tabs action "list"'))
    const run = e.queue
      .catch(() => undefined)
      .then(async () => {
        await this.bridge.call('tabs.activate', { tabId: e.chromeTabId, focus: false }).catch(() => undefined)
        return work()
      })
    e.queue = run
    return run
  }

  downloads(): BrowserDownloadInfo[] {
    return [...this.downloadList.values()].sort((a, b) => a.startedAt - b.startedAt)
  }

  notify(event: BrowserEvent): void {
    this.emit(event)
  }

  async userTabs(): Promise<{ chromeTabId: number; title: string; url: string }[]> {
    const all = await this.bridge.call<ExtTab[]>('tabs.list')
    return all.filter((t) => !t.sessionKey && /^https?:/.test(t.url)).map((t) => ({ chromeTabId: t.tabId, title: t.title, url: t.url }))
  }

  async borrow(chromeTabId: number, sessionKey: string): Promise<BrowserTabInfo> {
    const t = await this.bridge.call<ExtTab>('tabs.borrow', { tabId: chromeTabId, sessionKey })
    const e = this.upsert({ ...t, borrowed: true }, sessionKey)!
    e.borrowed = true
    return e.info
  }

  async giveBack(tabId: string): Promise<void> {
    const e = this.tabs.get(tabId)
    if (!e) return
    e.engine?.detach()
    await this.bridge.call('tabs.return', { tabId: e.chromeTabId }).catch(() => undefined)
    this.drop(tabId)
  }

  /** A conversation ended: give its borrowed tabs back (its own tabs stay open). */
  async releaseSession(sessionKey: string): Promise<void> {
    for (const [k, e] of this.tabs) if (e.borrowed && e.info.openedBy !== 'user' && e.info.openedBy.sessionKey === sessionKey) await this.giveBack(k)
  }
}
