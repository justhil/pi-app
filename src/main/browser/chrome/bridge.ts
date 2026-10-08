// Local WebSocket the pi Chrome extension connects to (BrowserSkill: CLI + extension). Only a
// chrome-extension:// origin with the pairing token gets in; one extension connection at a time.
// Requests are `{id, method, params}` → `{id, result | error}`; the extension also pushes
// `{event, params}` (CDP events, tab changes, downloads).

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

export type BridgeListener = (event: string, params: Record<string, any>) => void

export interface BridgeHello {
  version: string
  ua: string
  extensionId: string
}

const PORT_TRIES = 10
const CALL_TIMEOUT_MS = 20_000

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export class ChromeBridge {
  private wss: WebSocketServer | null = null
  private sock: WebSocket | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private listeners = new Set<BridgeListener>()
  hello: BridgeHello | null = null
  port = 0

  constructor(private readonly opts: { token: () => string; onStatus?: () => void }) {}

  /** Listen on 127.0.0.1, from `port` up to 10 ports further when taken. Resolves the port used. */
  async start(port: number): Promise<number> {
    if (this.wss) return this.port
    for (let p = port; p < port + PORT_TRIES; p++) {
      const ok = await new Promise<boolean>((resolve) => {
        const wss = new WebSocketServer({ host: '127.0.0.1', port: p, maxPayload: 64 * 1024 * 1024, verifyClient: (info: { origin: string }, done: (ok: boolean, code?: number) => void) => done(!!info.origin?.startsWith('chrome-extension://'), 403) })
        wss.once('listening', () => {
          this.wss = wss
          this.port = p
          wss.on('connection', (ws, req) => this.accept(ws, req))
          resolve(true)
        })
        wss.once('error', () => {
          wss.close()
          resolve(false)
        })
      })
      if (ok) return p
    }
    throw new Error(`no free port in ${port}–${port + PORT_TRIES - 1}`)
  }

  stop(): void {
    this.sock?.close(1001)
    this.sock = null
    this.hello = null
    this.wss?.close()
    this.wss = null
    this.port = 0
    this.failPending('the Chrome bridge stopped')
    this.opts.onStatus?.()
  }

  private tokenOk(req: IncomingMessage): boolean {
    const url = new URL(req.url ?? '/', 'ws://127.0.0.1')
    const token = this.opts.token()
    return url.pathname === '/chrome' && !!token && sameToken(url.searchParams.get('token') ?? '', token)
  }

  private accept(ws: WebSocket, req: IncomingMessage): void {
    // Wrong pairing code: close with 4401 so the extension says so instead of retrying forever.
    if (!this.tokenOk(req)) {
      ws.close(4401, 'bad token')
      return
    }
    // A newer connection (extension reloaded, another profile) replaces the old one.
    if (this.sock && this.sock !== ws) this.sock.close(4000, 'replaced')
    this.sock = ws
    ws.on('message', (data: RawData) => this.onMessage(ws, data))
    ws.on('close', () => {
      if (this.sock !== ws) return
      this.sock = null
      this.hello = null
      this.failPending('Chrome disconnected')
      this.emit('bridge.disconnected', {})
      this.opts.onStatus?.()
    })
  }

  private onMessage(ws: WebSocket, data: RawData): void {
    if (ws !== this.sock) return
    let msg: { id?: number; result?: unknown; error?: string; event?: string; params?: Record<string, any> }
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
      return
    }
    if (!msg.event || msg.event === 'ping') return
    if (msg.event === 'hello') {
      this.hello = msg.params as BridgeHello
      this.opts.onStatus?.()
    }
    this.emit(msg.event, msg.params ?? {})
  }

  private emit(event: string, params: Record<string, any>): void {
    for (const l of this.listeners) l(event, params)
  }

  private failPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
  }

  connected(): boolean {
    return !!this.sock && !!this.hello
  }

  call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
    const sock = this.sock
    if (!sock) return Promise.reject(new Error('Chrome is not connected: open Chrome with the pi extension paired (Settings → Browser → My Chrome)'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Chrome did not answer ${method} in ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      sock.send(JSON.stringify({ id, method, params }))
    })
  }

  on(listener: BridgeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
