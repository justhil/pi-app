import type { WebContents } from 'electron'
import type { BrowserLogEntry } from '@shared/browser-types'
import { PAGE_RUNTIME_SOURCE } from '../page-runtime.generated'
import { BrowserToolError } from '../agent/errors'
import { pendingRequestCount } from '../electron-session'
import type { Modifier, PageEngine } from './types'

/** Isolated world shared by every host page script; pages cannot see its globals. */
export const SCRIPT_WORLD = 1999
const DEFAULT_TIMEOUT_MS = 2000
const NEEDS_RUNTIME = '__piNeedsRuntime'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const KEY_ALIASES: Record<string, string> = {
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  space: 'Space',
  ' ': 'Space',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

/** `Enter`, `ArrowDown`, `Control+A`, `ControlOrMeta+K` → Electron keyCode + modifiers. */
export function parseKey(spec: string, platform: NodeJS.Platform = process.platform): { keyCode: string; modifiers: Modifier[] } {
  const parts = spec.split('+').map((p) => p.trim())
  // "Control++" means the plus key.
  const key = spec.trim() === '+' || spec.endsWith('++') ? '+' : (parts.pop() ?? '')
  if (spec.endsWith('++')) parts.splice(-1, 1)
  const modifiers = parts.filter(Boolean).map((m): Modifier => {
    const l = m.toLowerCase()
    if (l === 'controlormeta') return platform === 'darwin' ? 'meta' : 'control'
    if (l === 'ctrl' || l === 'control') return 'control'
    if (l === 'cmd' || l === 'command' || l === 'meta') return 'meta'
    if (l === 'option' || l === 'alt') return 'alt'
    return 'shift'
  })
  const keyCode = KEY_ALIASES[key.toLowerCase()] ?? (key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1))
  return { keyCode, modifiers }
}

/**
 * Engine E: the app's own Chromium (WebContentsView). No DevTools protocol: scripts run in an
 * isolated world, input goes through sendInputEvent, which pages see as trusted events.
 */
export class ElectronPageEngine implements PageEngine {
  readonly id = 'electron' as const

  constructor(
    private readonly wc: WebContents,
    private readonly getLogs: () => BrowserLogEntry[],
  ) {}

  private exec<T>(code: string, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    return Promise.race([
      this.wc.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code }]) as Promise<T>,
      new Promise<T>((_, reject) => {
        // A page blocked by alert()/confirm() never answers.
        timer = setTimeout(
          () => reject(new BrowserToolError('browser_dialog_pending', 'the page is not responding, most likely a dialog is open; ask the user to close it')),
          timeoutMs,
        )
      }),
    ]).finally(() => clearTimeout(timer))
  }

  async run<T>(expr: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const code = `(typeof __piBrowser === 'undefined') ? ${JSON.stringify(NEEDS_RUNTIME)} : (${expr})`
    const first = await this.exec<T | string>(code, timeoutMs)
    if (first !== NEEDS_RUNTIME) return first as T
    // New document: install the runtime (≈50 KB, parsed once per page), then retry.
    await this.exec(PAGE_RUNTIME_SOURCE, Math.max(timeoutMs, 5000))
    return (await this.exec<T>(code, timeoutMs)) as T
  }

  /** Page coordinates (CSS px) → view pixels; they differ while the fixed-viewport mode zooms. */
  private px(v: number): number {
    return Math.round(v * (this.wc.getZoomFactor() || 1))
  }

  mouse: PageEngine['mouse'] = {
    move: (x, y, button) => this.wc.sendInputEvent({ type: 'mouseMove', x: this.px(x), y: this.px(y), ...(button ? { button } : {}) } as Electron.MouseInputEvent),
    down: (x, y, o) => this.wc.sendInputEvent({ type: 'mouseDown', x: this.px(x), y: this.px(y), button: o.button, clickCount: o.clickCount, modifiers: o.modifiers }),
    up: (x, y, o) => this.wc.sendInputEvent({ type: 'mouseUp', x: this.px(x), y: this.px(y), button: o.button, clickCount: o.clickCount, modifiers: o.modifiers }),
    // Electron's wheel deltas are the opposite sign of DOM WheelEvent deltas.
    wheel: (x, y, deltaX, deltaY) =>
      this.wc.sendInputEvent({ type: 'mouseWheel', x: this.px(x), y: this.px(y), deltaX: -deltaX, deltaY: -deltaY, canScroll: true, hasPreciseScrollingDeltas: true }),
  }

  keyboard: PageEngine['keyboard'] = {
    press: async (spec) => {
      const { keyCode, modifiers } = parseKey(spec)
      this.wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      if (keyCode.length === 1 && !modifiers.some((m) => m === 'control' || m === 'meta' || m === 'alt')) {
        this.wc.sendInputEvent({ type: 'char', keyCode, modifiers })
      }
      await sleep(30 + Math.random() * 50)
      this.wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    },
    insertText: (text) => this.wc.insertText(text),
  }

  async screenshot(o: { clip?: { x: number; y: number; width: number; height: number }; maxWidth?: number }) {
    const z = this.wc.getZoomFactor() || 1
    const rect = o.clip
      ? { x: Math.max(0, Math.floor(o.clip.x * z)), y: Math.max(0, Math.floor(o.clip.y * z)), width: Math.ceil(o.clip.width * z), height: Math.ceil(o.clip.height * z) }
      : undefined
    let image = await this.wc.capturePage(rect, { stayHidden: true, stayAwake: true })
    if (image.isEmpty()) throw new BrowserToolError('browser_timeout', 'the page has not painted yet')
    const maxWidth = o.maxWidth ?? 1280
    if (image.getSize().width > maxWidth) image = image.resize({ width: maxWidth, quality: 'good' })
    const size = image.getSize()
    return { png: image.toPNG(), width: size.width, height: size.height }
  }

  pdf(): Promise<Buffer> {
    return this.wc.printToPDF({ printBackground: true })
  }

  async navigate(url: string): Promise<void> {
    try {
      await this.wc.loadURL(url)
    } catch (error) {
      // ERR_ABORTED is a redirect or a navigation the page replaced; the tab state tells the rest.
      const message = (error as Error)?.message ?? ''
      if (!/ERR_ABORTED/.test(message)) throw new BrowserToolError('browser_error', message.replace(/^Error invoking .*?: /, ''))
    }
  }

  async back(): Promise<boolean> {
    if (!this.wc.navigationHistory.canGoBack()) return false
    this.wc.navigationHistory.goBack()
    return true
  }

  url = () => this.wc.getURL()
  title = () => this.wc.getTitle()
  isLoading = () => this.wc.isLoading()
  logs = () => this.getLogs()
  pendingRequests = () => (this.wc.isDestroyed() ? 0 : pendingRequestCount(this.wc.id))
}
