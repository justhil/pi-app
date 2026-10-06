import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { base64UrlDecode, base64UrlEncode } from './pairing'
import {
  Hs1PayloadSchema,
  Hs1Schema,
  Hs2PayloadSchema,
  Hs2Schema,
  PROTOCOL_VERSION,
  type Hs1,
  type Hs1Payload,
  type Hs2,
  type Hs2Payload,
  type HandshakeErrorCode,
} from './frames'

/**
 * Remote channel crypto (Node only — never import from the renderer).
 * Handshake follows the Noise IK shape: the client knows the host's static key from the QR,
 * proves its own static key through DH, and both sides mix an ephemeral-ephemeral DH for
 * forward secrecy. X25519 + HKDF-SHA256 + ChaCha20-Poly1305 (IETF, 96-bit nonce).
 */

export const HKDF_SALT = new TextEncoder().encode('pi-remote/v1')
export const DEFLATE_THRESHOLD = 1024
export const MAX_FRAME_PLAINTEXT = 16 * 1024 * 1024

const PKCS8_PREFIX = Uint8Array.from(Buffer.from('302e020100300506032b656e04220420', 'hex'))
const SPKI_PREFIX = Uint8Array.from(Buffer.from('302a300506032b656e032100', 'hex'))
const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder('utf-8', { fatal: true })

export type KeyPair = { pub: Uint8Array; priv: Uint8Array }
export type SessionKeys = { c2s: Uint8Array; s2c: Uint8Array }

export class HandshakeError extends Error {
  constructor(readonly code: HandshakeErrorCode, message?: string) {
    super(message ?? code)
  }
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const privateKeyObject = (priv: Uint8Array) =>
  createPrivateKey({ key: Buffer.from(concat(PKCS8_PREFIX, priv)), format: 'der', type: 'pkcs8' })
const publicKeyObject = (pub: Uint8Array) =>
  createPublicKey({ key: Buffer.from(concat(SPKI_PREFIX, pub)), format: 'der', type: 'spki' })

export function generateKeyPair(): KeyPair {
  const { privateKey } = generateKeyPairSync('x25519')
  return keyPairFromPrivate(new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' })).slice(16))
}

export function keyPairFromPrivate(priv: Uint8Array): KeyPair {
  if (priv.length !== 32) throw new Error('x25519 private key must be 32 bytes')
  const pub = new Uint8Array(createPublicKey(privateKeyObject(priv)).export({ format: 'der', type: 'spki' })).slice(12)
  return { pub, priv: Uint8Array.from(priv) }
}

export function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  if (pub.length !== 32) throw new HandshakeError('bad', 'x25519 public key must be 32 bytes')
  let shared: Uint8Array
  try {
    shared = new Uint8Array(diffieHellman({ privateKey: privateKeyObject(priv), publicKey: publicKeyObject(pub) }))
  } catch {
    // OpenSSL refuses low-order points itself.
    throw new HandshakeError('bad', 'degenerate public key')
  }
  if (shared.every((b) => b === 0)) throw new HandshakeError('bad', 'degenerate public key')
  return shared
}

export function hkdf(ikm: Uint8Array, info: string, length: number): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', ikm, HKDF_SALT, utf8.encode(info), length))
}

/** 96-bit nonce: 64-bit little-endian counter followed by four zero bytes. */
export function counterNonce(counter: number): Uint8Array {
  const n = new Uint8Array(12)
  let c = BigInt(counter)
  for (let i = 0; i < 8; i++) {
    n[i] = Number(c & 0xffn)
    c >>= 8n
  }
  return n
}

// Pure-JS AEAD: Electron's BoringSSL build has no 'chacha20-poly1305' cipher for createCipheriv.
export function seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce, aad).encrypt(plaintext)
}

export function open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array {
  if (sealed.length < 16) throw new Error('ciphertext too short')
  return chacha20poly1305(key, nonce, aad).decrypt(sealed)
}

function deriveKeys(ikm: Uint8Array): { keys: SessionKeys; k2: Uint8Array } {
  const okm = hkdf(ikm, 'keys', 96)
  return { keys: { c2s: okm.slice(0, 32), s2c: okm.slice(32, 64) }, k2: okm.slice(64, 96) }
}

// ── Client side ─────────────────────────────────────────────────────────────

export type ClientHandshakeState = { hostPub: Uint8Array; clientStatic: KeyPair; ephemeral: KeyPair }

export function clientHs1(input: {
  hostPub: Uint8Array
  clientStatic: KeyPair
  payload: Omit<Hs1Payload, 's'>
  /** Tests only: fixed ephemeral key for deterministic vectors. */
  ephemeral?: KeyPair
}): { msg: Hs1; state: ClientHandshakeState } {
  const e = input.ephemeral ?? generateKeyPair()
  const k1 = hkdf(dh(e.priv, input.hostPub), 'hs1', 32)
  const payload: Hs1Payload = Hs1PayloadSchema.parse({ ...input.payload, s: base64UrlEncode(input.clientStatic.pub) })
  const ct = seal(k1, counterNonce(0), utf8.encode(JSON.stringify(payload)), concat(e.pub, input.hostPub))
  return {
    msg: { t: 'hs1', v: PROTOCOL_VERSION, e: base64UrlEncode(e.pub), ct: base64UrlEncode(ct) },
    state: { hostPub: input.hostPub, clientStatic: input.clientStatic, ephemeral: e },
  }
}

export function clientFinishHs2(state: ClientHandshakeState, raw: unknown): { payload: Hs2Payload; keys: SessionKeys } {
  const msg = Hs2Schema.parse(raw)
  const he = base64UrlDecode(msg.e)
  const { ephemeral: e, clientStatic: cs, hostPub } = state
  const { keys, k2 } = deriveKeys(concat(dh(e.priv, hostPub), dh(e.priv, he), dh(cs.priv, he), dh(cs.priv, hostPub)))
  const pt = open(k2, counterNonce(0), base64UrlDecode(msg.ct), he)
  return { payload: Hs2PayloadSchema.parse(JSON.parse(fromUtf8.decode(pt))), keys }
}

// ── Host side ───────────────────────────────────────────────────────────────

export type OpenedHs1 = { payload: Hs1Payload; clientEphemeral: Uint8Array; clientStatic: Uint8Array }

export function hostOpenHs1(hostStatic: KeyPair, raw: unknown): OpenedHs1 {
  const parsed = Hs1Schema.safeParse(raw)
  if (!parsed.success) throw new HandshakeError('bad', 'malformed hs1')
  try {
    const ce = base64UrlDecode(parsed.data.e)
    const k1 = hkdf(dh(hostStatic.priv, ce), 'hs1', 32)
    const pt = open(k1, counterNonce(0), base64UrlDecode(parsed.data.ct), concat(ce, hostStatic.pub))
    const payload = Hs1PayloadSchema.parse(JSON.parse(fromUtf8.decode(pt)))
    const clientStatic = base64UrlDecode(payload.s)
    if (clientStatic.length !== 32) throw new Error('bad static key')
    return { payload, clientEphemeral: ce, clientStatic }
  } catch (e) {
    if (e instanceof HandshakeError) throw e
    throw new HandshakeError('bad', 'hs1 did not decrypt')
  }
}

export function hostFinishHs2(
  hostStatic: KeyPair,
  opened: OpenedHs1,
  reply: Hs2Payload,
  ephemeral?: KeyPair,
): { msg: Hs2; keys: SessionKeys } {
  const he = ephemeral ?? generateKeyPair()
  const ce = opened.clientEphemeral
  const cs = opened.clientStatic
  const { keys, k2 } = deriveKeys(concat(dh(hostStatic.priv, ce), dh(he.priv, ce), dh(he.priv, cs), dh(hostStatic.priv, cs)))
  const ct = seal(k2, counterNonce(0), utf8.encode(JSON.stringify(Hs2PayloadSchema.parse(reply))), he.pub)
  return { msg: { t: 'hs2', e: base64UrlEncode(he.pub), ct: base64UrlEncode(ct) }, keys }
}

// ── Transport ───────────────────────────────────────────────────────────────

/**
 * One direction pair of an established session. Frames: `[flags][ciphertext]`, flags bit0 =
 * deflate-raw. Nonces are implicit per-direction counters, so a dropped, replayed or reordered
 * frame fails authentication and the connection must be closed.
 */
export class SecureChannel {
  private sendCounter = 0
  private recvCounter = 0

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly recvKey: Uint8Array,
  ) {}

  static forHost(keys: SessionKeys): SecureChannel {
    return new SecureChannel(keys.s2c, keys.c2s)
  }

  static forClient(keys: SessionKeys): SecureChannel {
    return new SecureChannel(keys.c2s, keys.s2c)
  }

  encrypt(message: unknown): Uint8Array {
    let body = utf8.encode(JSON.stringify(message))
    let flags = 0
    if (body.length > DEFLATE_THRESHOLD) {
      body = new Uint8Array(deflateRawSync(body))
      flags |= 1
    }
    const header = Uint8Array.of(flags)
    return concat(header, seal(this.sendKey, counterNonce(this.sendCounter++), body, header))
  }

  decrypt(frame: Uint8Array): unknown {
    if (frame.length < 17) throw new Error('frame too short')
    const header = frame.subarray(0, 1)
    if (header[0] & ~1) throw new Error('unknown frame flags')
    let body = open(this.recvKey, counterNonce(this.recvCounter), frame.subarray(1), header)
    this.recvCounter++
    if (header[0] & 1) body = new Uint8Array(inflateRawSync(body, { maxOutputLength: MAX_FRAME_PLAINTEXT }))
    return JSON.parse(fromUtf8.decode(body))
  }
}
