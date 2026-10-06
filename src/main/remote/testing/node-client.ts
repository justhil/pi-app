import { WebSocket } from 'ws'
import { base64UrlDecode, makePing, makeReq, parseFrame, type Frame, type HandshakeErrorCode, type Hs2Payload, type MethodParams, type MethodResult, type PairOffer, type RemoteMethod, type RpcError } from '@shared/remote'
import { HandshakeError, SecureChannel, clientFinishHs2, clientHs1, type KeyPair } from '@shared/remote/crypto'

/**
 * Minimal Node client used by gateway tests and `scripts/remote-probe.mjs`. It speaks exactly
 * what the phone speaks: plaintext hs1/hs2, then encrypted binary frames.
 */

export class RemoteRpcError extends Error {
  constructor(readonly err: RpcError) {
    super(`${err.code}: ${err.message}`)
  }
}

export type ReceivedEvent = { m: string; p: unknown }

export class NodeRemoteClient {
  private ws: WebSocket | null = null
  private channel: SecureChannel | null = null
  private nextId = 0
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  readonly events: ReceivedEvent[] = []
  private readonly waiters: Array<{ match: (e: ReceivedEvent) => boolean; resolve: (e: ReceivedEvent) => void }> = []
  hello: Hs2Payload | null = null
  /** Raw frames observed on the socket (for "no plaintext after handshake" assertions). */
  readonly rawFrames: Array<{ binary: boolean; bytes: Buffer }> = []
  closeCode: number | null = null

  constructor(
    readonly identity: KeyPair,
    readonly name = 'probe',
  ) {}

  /** Connect and authenticate. Pass `pairToken` the first time. Rejects with HandshakeError on refusal. */
  connect(endpoint: string, hostPub: Uint8Array, pairToken?: string): Promise<Hs2Payload> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint.replace(/\/?$/, '/ws').replace(/\/ws\/ws$/, '/ws'))
      this.ws = ws
      const { msg, state } = clientHs1({ hostPub, clientStatic: this.identity, payload: { name: this.name, platform: 'node', ...(pairToken ? { pair: pairToken } : {}) } })
      ws.on('open', () => ws.send(JSON.stringify(msg)))
      ws.on('message', (data, isBinary) => {
        const bytes = Buffer.from(data as Buffer)
        this.rawFrames.push({ binary: isBinary, bytes })
        if (!this.channel) {
          try {
            const reply = JSON.parse(bytes.toString('utf8'))
            if (reply.t === 'hs_err') return reject(new HandshakeError(reply.code as HandshakeErrorCode))
            const fin = clientFinishHs2(state, reply)
            this.channel = SecureChannel.forClient(fin.keys)
            this.hello = fin.payload
            resolve(fin.payload)
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
          return
        }
        this.onFrame(parseFrame(this.channel.decrypt(new Uint8Array(bytes))))
      })
      ws.on('close', (code) => {
        this.closeCode = code
        for (const p of this.pending.values()) p.reject(new Error(`socket closed (${code})`))
        this.pending.clear()
        if (!this.channel) reject(new Error(`closed during handshake (${code})`))
      })
      ws.on('error', (e) => {
        if (!this.channel) reject(e)
      })
    })
  }

  static connectOffer(identity: KeyPair, offer: PairOffer, usePairToken = true): Promise<{ client: NodeRemoteClient; hello: Hs2Payload }> {
    const client = new NodeRemoteClient(identity)
    return client.connect(offer.endpoints[0], base64UrlDecode(offer.hostPub), usePairToken ? offer.pairToken : undefined).then((hello) => ({ client, hello }))
  }

  private onFrame(frame: Frame | null): void {
    if (!frame) return
    if (frame.k === 'res') {
      const p = this.pending.get(frame.id)
      if (!p) return
      this.pending.delete(frame.id)
      if (frame.ok) p.resolve(frame.p)
      else p.reject(new RemoteRpcError(frame.err))
      return
    }
    if (frame.k === 'pong') {
      this.pending.get(frame.id)?.resolve(null)
      this.pending.delete(frame.id)
      return
    }
    if (frame.k === 'evt') {
      const e = { m: frame.m, p: frame.p }
      this.events.push(e)
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i].match(e)) {
          this.waiters[i].resolve(e)
          this.waiters.splice(i, 1)
        }
      }
    }
  }

  private send(frame: Frame): void {
    if (!this.ws || !this.channel) throw new Error('not connected')
    this.ws.send(this.channel.encrypt(frame), { binary: true })
  }

  call<M extends RemoteMethod>(method: M, params: MethodParams<M>, timeoutMs = 10_000): Promise<MethodResult<M>> {
    const id = `c${++this.nextId}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as MethodResult<M>)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.send(makeReq(id, method, params))
    })
  }

  ping(): Promise<unknown> {
    const id = `p${++this.nextId}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send(makePing(id))
    })
  }

  /** Resolve with the first (past or future) event matching. */
  waitFor(match: (e: ReceivedEvent) => boolean, timeoutMs = 5000): Promise<ReceivedEvent> {
    const seen = this.events.find(match)
    if (seen) return Promise.resolve(seen)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for event')), timeoutMs)
      this.waiters.push({
        match,
        resolve: (e) => {
          clearTimeout(timer)
          resolve(e)
        },
      })
    })
  }

  /** Send arbitrary bytes on the socket (tests: tampering, plaintext injection). */
  sendRaw(data: Buffer | string, binary: boolean): void {
    this.ws?.send(data, { binary })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return resolve()
      this.ws.once('close', () => resolve())
      this.ws.close()
    })
  }
}
