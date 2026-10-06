import { randomBytes } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import {
  makeErr,
  makeEvt,
  makeOk,
  makePong,
  parseFrame,
  type HandshakeErrorCode,
  type RemoteEvent,
  type Role,
  type TurnPatch,
} from '@shared/remote'
import { HandshakeError, SecureChannel, hostFinishHs2, hostOpenHs1 } from '@shared/remote/crypto'
import { base64UrlEncode } from '@shared/remote'
import type { AuthStore } from './auth-store'
import { RpcFail } from './errors'
import type { RemoteHostPort } from './host-port'
import type { RemoteRpc, RpcCaller } from './rpc'
import type { SessionHub } from './session-hub'

export const HANDSHAKE_TIMEOUT_MS = 10_000
export const IDLE_TIMEOUT_MS = 75_000
export const PATCH_FLUSH_MS = 60
const MAX_BUFFERED = 8 * 1024 * 1024

export type ConnectionDeps = {
  auth: AuthStore
  hub: SessionHub
  rpc: RemoteRpc
  port: RemoteHostPort
  hostName: () => string
  onHandshakeFailure: () => void
  onClosed: (conn: RemoteConnection) => void
}

/**
 * One phone connection: plaintext `hs1`/`hs2` JSON text frames, then only encrypted binary
 * frames. Any decryption failure, protocol violation or slow consumer closes the socket;
 * the client reconnects and resumes from its cursor.
 */
export class RemoteConnection implements RpcCaller {
  readonly id = `c_${base64UrlEncode(randomBytes(6))}`
  deviceId = ''
  private channel: SecureChannel | null = null
  private closed = false
  private handshakeTimer: ReturnType<typeof setTimeout> | null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly patchBuffer = new Map<string, TurnPatch[]>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly ws: WebSocket,
    private readonly deps: ConnectionDeps,
  ) {
    this.handshakeTimer = setTimeout(() => this.close(4000, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS)
    ws.on('message', (data, isBinary) => this.onMessage(data, isBinary))
    ws.on('close', () => this.cleanup())
    ws.on('error', () => this.close(1011, 'socket error'))
  }

  get ready(): boolean {
    return !!this.channel && !this.closed
  }

  role(): Role {
    return this.deps.auth.device(this.deviceId)?.role ?? 'viewer'
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.close(4001, 'idle'), IDLE_TIMEOUT_MS)
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (this.closed) return
    const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
    if (!this.channel) {
      if (isBinary) return this.failHandshake('bad')
      void this.handshake(bytes.toString('utf8'))
      return
    }
    if (!isBinary) return this.close(4002, 'plaintext after handshake')
    let raw: unknown
    try {
      raw = this.channel.decrypt(new Uint8Array(bytes))
    } catch {
      return this.close(4002, 'decrypt failed')
    }
    this.touch()
    const frame = parseFrame(raw)
    if (!frame) return this.close(4003, 'bad frame')
    if (frame.k === 'ping') return this.send(makePong(frame.id))
    if (frame.k !== 'req') return
    void this.deps.rpc.dispatch(this, frame.m, frame.p).then(
      (result) => this.send(makeOk(frame.id, result)),
      (error: unknown) => {
        if (error instanceof RpcFail) return this.send(makeErr(frame.id, error.code, error.message, error.retryable))
        this.deps.port.log('error', `[remote] ${frame.m} failed: ${error instanceof Error ? error.message : String(error)}`)
        this.send(makeErr(frame.id, 'internal', error instanceof Error ? error.message : 'internal error', true))
      },
    )
  }

  private async handshake(text: string): Promise<void> {
    const { auth, hub } = this.deps
    let msg: unknown
    try {
      msg = JSON.parse(text)
    } catch {
      return this.failHandshake('bad')
    }
    try {
      const opened = hostOpenHs1(auth.hostKey(), msg)
      let device = auth.findDevice(opened.clientStatic)
      if (opened.payload.pair) {
        const r = auth.consumePairToken(opened.payload.pair)
        if (r === 'ok') device = auth.registerDevice(opened.clientStatic, opened.payload.name, opened.payload.platform)
        else if (!device || device.revokedAt) return this.failHandshake(r)
      }
      if (!device) return this.failHandshake('unpaired')
      if (device.revokedAt) return this.failHandshake('revoked')
      const { msg: hs2, keys } = hostFinishHs2(auth.hostKey(), opened, {
        deviceId: device.id,
        hostId: auth.config.hostId,
        hostName: this.deps.hostName(),
        epoch: hub.epoch,
        role: device.role,
      })
      if (this.closed) return
      this.ws.send(JSON.stringify(hs2))
      this.channel = SecureChannel.forHost(keys)
      this.deviceId = device.id
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
      auth.touchDevice(device.id)
      this.touch()
      this.deps.port.log('info', `[remote] device ${device.id} connected`)
    } catch (error) {
      this.failHandshake(error instanceof HandshakeError ? error.code : 'bad')
    }
  }

  private failHandshake(code: HandshakeErrorCode): void {
    this.deps.onHandshakeFailure()
    if (!this.closed) {
      try {
        this.ws.send(JSON.stringify({ t: 'hs_err', code }))
      } catch {
        /* closing anyway */
      }
    }
    this.close(4004, code)
  }

  private send(frame: object): void {
    if (!this.channel || this.closed) return
    if (this.ws.bufferedAmount > MAX_BUFFERED) return this.close(4005, 'slow consumer')
    this.ws.send(this.channel.encrypt(frame), { binary: true })
  }

  sendEvent(event: RemoteEvent, payload: unknown): void {
    if (event === 'turn.patch') return
    this.send(makeEvt(event, payload))
  }

  queuePatches(sessionKey: string, patches: TurnPatch[]): void {
    if (!this.ready || !patches.length) return
    const buf = this.patchBuffer.get(sessionKey) ?? []
    for (const p of patches) {
      const last = buf[buf.length - 1]
      // Coalesce streaming text: one append per (turn, ref) per flush window. The merged patch keeps
      // its first seq and covers through `seqTo`, so clients still see a gap-free sequence.
      if (p.op === 'text.append' && last?.op === 'text.append' && last.turnId === p.turnId && last.ref === p.ref && (last.seqTo ?? last.seq) + 1 === p.seq) {
        buf[buf.length - 1] = { ...last, seqTo: p.seq, delta: last.delta + p.delta }
      } else buf.push(p)
    }
    this.patchBuffer.set(sessionKey, buf)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushPatches(), PATCH_FLUSH_MS)
  }

  private flushPatches(): void {
    this.flushTimer = null
    for (const [sessionKey, patches] of this.patchBuffer) {
      if (patches.length) this.send(makeEvt('turn.patch', { sessionKey, patches }))
    }
    this.patchBuffer.clear()
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return
    this.closed = true
    try {
      this.ws.close(code, reason.slice(0, 120))
    } catch {
      /* already gone */
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.closed = true
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.handshakeTimer = this.idleTimer = this.flushTimer = null
    this.patchBuffer.clear()
    this.deps.hub.detach(this)
    this.deps.onClosed(this)
  }
}
