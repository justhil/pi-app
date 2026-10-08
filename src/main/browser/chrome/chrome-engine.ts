// PageEngine for a tab of the user's own Chrome: everything goes through the DevTools protocol
// that the pi extension relays. The page runtime, executor and humanized input are the same
// ones the built-in browser uses.

import type { BrowserLogEntry } from '@shared/browser-types'
import { BrowserToolError } from '../agent/errors'
import { CdpTab } from '../cdp/cdp-tab'
import type { Modifier, MouseButton, PageEngine, Rect } from '../engines/types'
import { PAGE_RUNTIME_SOURCE } from '../page-runtime.generated'
import type { ChromeBridge } from './bridge'
import { ExtensionCdp } from './extension-cdp'
import { cdpKey } from './keys'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MOD_BITS: Record<Modifier, number> = { alt: 1, control: 2, meta: 4, shift: 8 }
const bits = (mods: Modifier[] = []) => mods.reduce((n, m) => n | MOD_BITS[m], 0)
const BUTTONS: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 }
const MAX_LOGS = 200

export interface ChromeTabState {
  url: string
  title: string
  loading: boolean
}

export class ChromePageEngine implements PageEngine {
  readonly id = 'chrome' as const
  private readonly cdp: ExtensionCdp
  private readonly tab: CdpTab
  private logList: BrowserLogEntry[] = []
  private ready: Promise<void> | null = null

  constructor(
    bridge: ChromeBridge,
    readonly chromeTabId: number,
    private state: ChromeTabState,
  ) {
    this.cdp = new ExtensionCdp(bridge, chromeTabId)
    this.tab = new CdpTab(this.cdp, PAGE_RUNTIME_SOURCE)
    this.cdp.on((method, params, sessionId) => {
      if (sessionId) return
      const p = params as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      if (method === 'Page.frameNavigated' && !p.frame?.parentId) this.state = { ...this.state, url: p.frame.url }
      else if (method === 'Page.frameStartedLoading') this.state = { ...this.state, loading: true }
      else if (method === 'Page.loadEventFired' || method === 'Page.frameStoppedLoading') this.state = { ...this.state, loading: false }
      else if (method === 'Log.entryAdded' && (p.entry?.level === 'error' || p.entry?.level === 'warning')) this.log('network', p.entry.level, p.entry.text, p.entry.url)
      else if (method === 'pi.detached') this.ready = null
    })
  }

  private log(kind: BrowserLogEntry['kind'], level: 'error' | 'warning', message: string, source?: string) {
    this.logList.push({ at: Date.now(), kind, level, message: String(message).slice(0, 500), ...(source ? { source } : {}) })
    if (this.logList.length > MAX_LOGS) this.logList.shift()
  }

  /** Tab facts pushed by the extension (chrome.tabs.onUpdated). */
  update(state: Partial<ChromeTabState>): void {
    this.state = { ...this.state, ...state }
  }

  private start(): Promise<void> {
    this.ready ??= (async () => {
      await this.tab.start()
      await this.cdp.send('Log.enable').catch(() => undefined)
      // Keep focus-dependent pages working while the Agent window is in the background.
      await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
    })().catch((error) => {
      this.ready = null
      throw error
    })
    return this.ready
  }

  async run<T>(expr: string, timeoutMs = 2000): Promise<T> {
    await this.start()
    return this.tab.runInFrame<T>(await this.tab.mainFrameId(), expr, timeoutMs)
  }

  async runMain<T>(expr: string, timeoutMs = 2000): Promise<T> {
    await this.start()
    return this.tab.runMain<T>(expr, timeoutMs)
  }

  private input(params: Record<string, unknown>): void {
    void this.cdp.send('Input.dispatchMouseEvent', params).catch(() => undefined)
  }

  mouse: PageEngine['mouse'] = {
    move: (x, y, button) => this.input({ type: 'mouseMoved', x, y, ...(button ? { button, buttons: BUTTONS[button] } : {}) }),
    down: (x, y, o) => this.input({ type: 'mousePressed', x, y, button: o.button, buttons: BUTTONS[o.button], clickCount: o.clickCount, modifiers: bits(o.modifiers) }),
    up: (x, y, o) => this.input({ type: 'mouseReleased', x, y, button: o.button, buttons: 0, clickCount: o.clickCount, modifiers: bits(o.modifiers) }),
    wheel: (x, y, deltaX, deltaY) => this.input({ type: 'mouseWheel', x, y, deltaX, deltaY }),
  }

  keyboard: PageEngine['keyboard'] = {
    press: async (spec) => {
      await this.start()
      const k = cdpKey(spec)
      const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: k.modifiers }
      await this.cdp.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) })
      await sleep(30 + Math.random() * 50)
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    },
    insertText: async (text) => {
      await this.start()
      await this.cdp.send('Input.insertText', { text })
    },
  }

  async screenshot(o: { clip?: Rect; maxWidth?: number }): Promise<{ png: Buffer; width: number; height: number }> {
    await this.start()
    const m = await this.cdp.send<{ cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics')
    const vv = m.cssVisualViewport
    // CDP clips are in document coordinates; ours are viewport coordinates.
    const region = o.clip ? { x: o.clip.x + vv.pageX, y: o.clip.y + vv.pageY, width: o.clip.width, height: o.clip.height } : { x: vv.pageX, y: vv.pageY, width: vv.clientWidth, height: vv.clientHeight }
    const scale = Math.min(1, (o.maxWidth ?? 1280) / Math.max(1, region.width))
    const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { ...region, scale } })
    return { png: Buffer.from(data, 'base64'), width: Math.round(region.width * scale), height: Math.round(region.height * scale) }
  }

  async pdf(): Promise<Buffer> {
    await this.start()
    try {
      const { data } = await this.cdp.send<{ data: string }>('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
      return Buffer.from(data, 'base64')
    } catch (error) {
      // Older Chrome builds refuse printToPDF outside headless mode.
      throw new BrowserToolError('browser_unsupported', `this Chrome cannot print to PDF (${(error as Error).message}); use browser_take_screenshot fullPage instead`)
    }
  }

  async navigate(url: string): Promise<void> {
    await this.start()
    this.state = { ...this.state, loading: true }
    const res = await this.cdp.send<{ errorText?: string }>('Page.navigate', { url })
    if (res.errorText && !/ERR_ABORTED/.test(res.errorText)) throw new BrowserToolError('browser_error', res.errorText)
  }

  async back(): Promise<boolean> {
    await this.start()
    const h = await this.cdp.send<{ currentIndex: number; entries: { id: number }[] }>('Page.getNavigationHistory')
    if (h.currentIndex <= 0) return false
    this.state = { ...this.state, loading: true }
    await this.cdp.send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id })
    return true
  }

  url = () => this.state.url
  title = () => this.state.title
  isLoading = () => this.state.loading
  logs = () => this.logList
  pendingRequests = () => this.tab.network.pending()
  cdpTab = () => this.tab

  get dialog(): PageEngine['dialog'] {
    return { pending: () => this.tab.pendingDialog(), handle: (accept, promptText) => this.tab.handleDialog(accept, promptText) }
  }

  detach(): void {
    this.cdp.close()
  }
}
