/* eslint-disable @typescript-eslint/no-explicit-any -- CDP / extension payloads are untyped protocol JSON, read field by field */
// Agent features that need the DevTools protocol, written once against CdpSession: frames
// (including out-of-process iframes), page dialogs, full-page capture, device emulation, a
// highlight box and the request log. The built-in engine and the Chrome engine both use it.

import { BrowserToolError } from '../agent/errors'
import type { DialogInfo, Rect } from '../engines/types'
import { NetworkLog } from './network-log'
import type { CdpSession } from './types'

export interface FrameInfo {
  frameId: string
  parentId: string | null
  url: string
  name: string
  /** Set for out-of-process (cross-site) frames: commands go to their own target session. */
  sessionId?: string
}

export type EmulationPreset = 'iphone-14' | 'pixel-7' | 'ipad' | 'desktop'

const PRESETS: Record<EmulationPreset, { width: number; height: number; dpr: number; mobile: boolean; touch: boolean; ua?: string }> = {
  'iphone-14': { width: 390, height: 844, dpr: 3, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  'pixel-7': { width: 412, height: 915, dpr: 2.625, mobile: true, touch: true, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  ipad: { width: 820, height: 1180, dpr: 2, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  desktop: { width: 1280, height: 800, dpr: 1, mobile: false, touch: false },
}

const WORLD = 'pi-agent'
const MAX_FULL_HEIGHT = 16_384
const NEEDS_RUNTIME = '__piNeedsRuntime'

type MouseOpts = { button: 'left' | 'right' | 'middle'; clickCount: number; modifiers: string[] }
type EvalResult = { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }

export class CdpTab {
  readonly network = new NetworkLog()
  private dialog: (DialogInfo & { defaultPrompt?: string }) | null = null
  private worlds = new Map<string, number>()
  private frameSessions = new Map<string, string>()
  private parents = new Map<string, string>()
  private starting: Promise<void> | null = null
  private overlayOn = false
  private originalUa: string | null = null
  private topFrame: string | null = null

  constructor(
    readonly cdp: CdpSession,
    private readonly runtimeSource: string,
  ) {
    cdp.on((method, params, sessionId) => this.onEvent(method, params as Record<string, any>, sessionId))
  }

  /** Enable the domains the agent relies on (idempotent; redone after a detach). */
  start(): Promise<void> {
    this.starting ??= (async () => {
      await this.cdp.send('Page.enable')
      await this.cdp.send('Network.enable', { maxTotalBufferSize: 32_000_000, maxResourceBufferSize: 8_000_000 })
      // Not awaited: some hosts answer late (or never) while frames attach; frames() works without it.
      void this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined)
    })().catch((error) => {
      this.starting = null
      throw error
    })
    return this.starting
  }

  private onEvent(method: string, p: Record<string, any>, sessionId?: string): void {
    switch (method) {
      case 'Page.javascriptDialogOpening':
        this.dialog = { type: p.type, message: p.message ?? '', defaultPrompt: p.defaultPrompt }
        return
      case 'Page.javascriptDialogClosed':
        this.dialog = null
        return
      case 'Page.frameNavigated':
        this.worlds.delete(p.frame?.id)
        if (!p.frame?.parentId && !sessionId) this.topFrame = p.frame?.id ?? this.topFrame
        return
      case 'Page.frameAttached':
        if (p.parentFrameId) this.parents.set(p.frameId, p.parentFrameId)
        return
      case 'Target.attachedToTarget':
        if (p.targetInfo?.type === 'iframe') {
          const frameId = p.targetInfo.targetId as string
          this.frameSessions.set(frameId, p.sessionId)
          this.worlds.delete(frameId)
          void this.cdp.send('Page.enable', {}, p.sessionId).catch(() => undefined)
          void this.cdp.send('Network.enable', {}, p.sessionId).catch(() => undefined)
          void this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, p.sessionId).catch(() => undefined)
        }
        return
      case 'Target.detachedFromTarget':
        for (const [frame, s] of this.frameSessions) if (s === p.sessionId) this.frameSessions.delete(frame)
        return
      case 'pi.detached':
        this.starting = null
        this.overlayOn = false
        this.worlds.clear()
        this.frameSessions.clear()
        return
      default:
        if (method.startsWith('Network.')) this.network.onEvent(method, p, sessionId)
    }
  }

  /** The top document's frame id (stable for the tab's lifetime). */
  async mainFrameId(): Promise<string> {
    if (this.topFrame) return this.topFrame
    await this.start()
    const { frameTree } = await this.cdp.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree')
    this.topFrame = frameTree.frame.id
    return this.topFrame
  }

  // ── dialogs ──────────────────────────────────────────────────────────────

  pendingDialog(): DialogInfo | null {
    return this.dialog ? { type: this.dialog.type, message: this.dialog.message } : null
  }

  async handleDialog(accept: boolean, promptText?: string): Promise<void> {
    await this.cdp.send('Page.handleJavaScriptDialog', { accept, ...(promptText !== undefined ? { promptText } : {}) })
    this.dialog = null
  }

  // ── frames ───────────────────────────────────────────────────────────────

  /** Every frame below the main one, in document order, with how to reach it. */
  async frames(): Promise<FrameInfo[]> {
    await this.start()
    const out: FrameInfo[] = []
    const seen = new Set<string>()
    const walk = (node: any, parentId: string | null, sessionId?: string) => {
      const f = node.frame
      if (!seen.has(f.id)) {
        seen.add(f.id)
        if (parentId) out.push({ frameId: f.id, parentId, url: f.url, name: f.name ?? '', sessionId })
      }
      for (const c of node.childFrames ?? []) walk(c, f.id, sessionId)
    }
    const main = await this.cdp.send<{ frameTree: any }>('Page.getFrameTree')
    walk(main.frameTree, null)
    for (const [frameId, sessionId] of this.frameSessions) {
      if (seen.has(frameId)) {
        // Listed by the parent as a placeholder: route it to its own session.
        const f = out.find((x) => x.frameId === frameId)
        if (f) f.sessionId = sessionId
      }
      const tree = await this.cdp.send<{ frameTree: any }>('Page.getFrameTree', {}, sessionId).catch(() => null)
      if (!tree) continue
      const parent = this.parents.get(frameId) ?? main.frameTree.frame.id
      if (!seen.has(frameId)) {
        seen.add(frameId)
        out.push({ frameId, parentId: parent, url: tree.frameTree.frame.url, name: tree.frameTree.frame.name ?? '', sessionId })
      }
      for (const c of tree.frameTree.childFrames ?? []) walk(c, frameId, sessionId)
    }
    return out
  }

  /** Attributes of the <iframe> that hosts `frameId` (asked of the parent's process). */
  async frameOwner(frameId: string, parentSessionId?: string): Promise<Record<string, string> | null> {
    try {
      const { backendNodeId } = await this.cdp.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId }, parentSessionId)
      const { node } = await this.cdp.send<{ node: { attributes?: string[] } }>('DOM.describeNode', { backendNodeId }, parentSessionId)
      const attrs: Record<string, string> = {}
      const list = node.attributes ?? []
      for (let i = 0; i + 1 < list.length; i += 2) attrs[list[i]] = list[i + 1]
      return attrs
    } catch {
      return null
    }
  }

  /**
   * Mouse input sent straight to an out-of-process frame's own target, in frame coordinates.
   * Routing through the top page fails while that frame has not rendered (a background window):
   * the events land on the parent's <iframe> element instead.
   */
  frameMouse(sessionId: string): { move(x: number, y: number, button?: 'left' | 'right' | 'middle'): void; down(x: number, y: number, o: MouseOpts): void; up(x: number, y: number, o: MouseOpts): void; wheel(x: number, y: number, dx: number, dy: number): void } {
    const send = (params: Record<string, unknown>) => void this.cdp.send('Input.dispatchMouseEvent', params, sessionId).catch(() => undefined)
    const bit = { left: 1, right: 2, middle: 4 } as const
    const mods = (m: string[] = []) => m.reduce((n, k) => n | ({ alt: 1, control: 2, meta: 4, shift: 8 } as Record<string, number>)[k], 0)
    return {
      move: (x, y, button) => send({ type: 'mouseMoved', x, y, ...(button ? { button, buttons: bit[button] } : {}) }),
      down: (x, y, o) => send({ type: 'mousePressed', x, y, button: o.button, buttons: bit[o.button], clickCount: o.clickCount, modifiers: mods(o.modifiers) }),
      up: (x, y, o) => send({ type: 'mouseReleased', x, y, button: o.button, buttons: 0, clickCount: o.clickCount, modifiers: mods(o.modifiers) }),
      wheel: (x, y, deltaX, deltaY) => send({ type: 'mouseWheel', x, y, deltaX, deltaY }),
    }
  }

  /** The target session of an out-of-process frame (undefined: the frame lives in the top target). */
  frameSession(frameId: string): string | undefined {
    return this.sessionOf(frameId)
  }

  private sessionOf(frameId: string): string | undefined {
    if (this.frameSessions.has(frameId)) return this.frameSessions.get(frameId)
    let id: string | undefined = frameId
    while (id) {
      const s = this.frameSessions.get(id)
      if (s) return s
      id = this.parents.get(id)
    }
    return undefined
  }

  private async evaluate(expression: string, contextId: number | undefined, sessionId: string | undefined, timeoutMs: number): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined
    const res = await Promise.race([
      this.cdp.send<EvalResult>('Runtime.evaluate', { expression, ...(contextId ? { contextId } : {}), returnByValue: true, awaitPromise: true }, sessionId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new BrowserToolError('browser_dialog_pending', this.dialog ? `a ${this.dialog.type} dialog is open: "${this.dialog.message.slice(0, 200)}"; call browser_handle_dialog` : 'the page is not responding')),
          timeoutMs,
        )
      }),
    ]).finally(() => clearTimeout(timer))
    if (res.exceptionDetails) throw new BrowserToolError('browser_error', res.exceptionDetails.exception?.description?.split('\n')[0] ?? res.exceptionDetails.text ?? 'script error')
    return res.result?.value
  }

  private async world(frameId: string, sessionId: string | undefined, fresh = false): Promise<number> {
    if (!fresh && this.worlds.has(frameId)) return this.worlds.get(frameId)!
    const { executionContextId } = await this.cdp.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId, worldName: WORLD, grantUniveralAccess: false }, sessionId)
    this.worlds.set(frameId, executionContextId)
    return executionContextId
  }

  /** Run `expr` in a frame's isolated world with the page runtime as `__piBrowser`. */
  async runInFrame<T>(frameId: string, expr: string, timeoutMs = 2000): Promise<T> {
    await this.start()
    const sessionId = this.sessionOf(frameId)
    const code = `(typeof __piBrowser === 'undefined') ? ${JSON.stringify(NEEDS_RUNTIME)} : (${expr})`
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctx = await this.world(frameId, sessionId, attempt > 0)
      try {
        let value = await this.evaluate(code, ctx, sessionId, timeoutMs)
        if (value === NEEDS_RUNTIME) {
          await this.evaluate(this.runtimeSource, ctx, sessionId, Math.max(timeoutMs, 5000))
          value = await this.evaluate(code, ctx, sessionId, timeoutMs)
        }
        return value as T
      } catch (error) {
        // The frame navigated: its old world is gone. Make a new one once.
        if (attempt === 0 && /context|Cannot find/i.test((error as Error).message)) continue
        throw error
      }
    }
    throw new BrowserToolError('browser_error', 'frame is not reachable')
  }

  /** The main world of the main frame (or of `frameId`). */
  async runMain<T>(expr: string, timeoutMs = 2000, frameId?: string): Promise<T> {
    await this.start()
    if (!frameId) return (await this.evaluate(expr, undefined, undefined, timeoutMs)) as T
    const sessionId = this.sessionOf(frameId)
    const tree = sessionId ? null : await this.cdp.send<{ frameTree: any }>('Page.getFrameTree')
    if (sessionId || tree?.frameTree.frame.id === frameId) return (await this.evaluate(expr, undefined, sessionId, timeoutMs)) as T
    throw new BrowserToolError('browser_unsupported', 'main-world evaluation in a same-process child frame is not supported; use the isolated world')
  }

  // ── capture & emulation ──────────────────────────────────────────────────

  /** The whole document as one image, scaled down to `maxWidth` by the browser. */
  async fullPage(maxWidth = 1280): Promise<{ png: Buffer; width: number; height: number; clipped: boolean }> {
    await this.start()
    const m = await this.cdp.send<{ cssContentSize?: { width: number; height: number }; contentSize: { width: number; height: number } }>('Page.getLayoutMetrics')
    const size = m.cssContentSize ?? m.contentSize
    const width = Math.ceil(size.width)
    const height = Math.min(Math.ceil(size.height), MAX_FULL_HEIGHT)
    const scale = Math.min(1, maxWidth / Math.max(1, width))
    const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale } })
    return { png: Buffer.from(data, 'base64'), width: Math.round(width * scale), height: Math.round(height * scale), clipped: size.height > MAX_FULL_HEIGHT }
  }

  async emulate(preset: EmulationPreset | null, currentUa: () => Promise<string>): Promise<void> {
    await this.start()
    if (!preset) {
      await this.cdp.send('Emulation.clearDeviceMetricsOverride')
      await this.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      if (this.originalUa) await this.cdp.send('Emulation.setUserAgentOverride', { userAgent: this.originalUa })
      return
    }
    const p = PRESETS[preset]
    this.originalUa ??= await currentUa()
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: p.dpr, mobile: p.mobile })
    await this.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: p.touch, ...(p.touch ? { maxTouchPoints: 5 } : {}) })
    await this.cdp.send('Emulation.setUserAgentOverride', { userAgent: p.ua ?? this.originalUa })
  }

  /** A box drawn by the browser itself (the page's DOM is untouched). Null clears it. */
  async highlight(rect: Rect | null): Promise<void> {
    await this.start()
    if (!rect) {
      if (this.overlayOn) await this.cdp.send('Overlay.hideHighlight').catch(() => undefined)
      return
    }
    if (!this.overlayOn) {
      await this.cdp.send('DOM.enable')
      await this.cdp.send('Overlay.enable')
      this.overlayOn = true
    }
    await this.cdp.send('Overlay.highlightRect', {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      color: { r: 255, g: 170, b: 0, a: 0.18 },
      outlineColor: { r: 255, g: 140, b: 0, a: 1 },
    })
  }

  /** Response body of a logged request (text capped, binary summarized). */
  /** Raw command for the agent's escape hatch, to the top page or an out-of-process frame. */
  async raw(method: string, params: Record<string, unknown> = {}, frameId?: string): Promise<unknown> {
    await this.start()
    return this.cdp.send(method, params, frameId ? this.sessionOf(frameId) : undefined)
  }

  async body(requestId: string, sessionId?: string): Promise<{ text: string; base64: boolean }> {
    const r = await this.cdp.send<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId }, sessionId)
    return { text: r.body, base64: r.base64Encoded }
  }
}

export const EMULATION_PRESETS = Object.keys(PRESETS) as EmulationPreset[]
