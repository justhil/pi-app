import { describe, expect, it } from 'vitest'
import {
  HandshakeError,
  SecureChannel,
  clientFinishHs2,
  clientHs1,
  counterNonce,
  dh,
  generateKeyPair,
  hostFinishHs2,
  hostOpenHs1,
  keyPairFromPrivate,
  open,
  seal,
} from '../crypto'
import { base64UrlDecode, base64UrlEncode } from '../pairing'

const reply = { deviceId: 'd_1', hostId: 'h_1', hostName: 'desk', epoch: 'e_1', role: 'operator' as const }

function handshake() {
  const host = generateKeyPair()
  const client = generateKeyPair()
  const { msg, state } = clientHs1({ hostPub: host.pub, clientStatic: client, payload: { name: 'Pixel', platform: 'android-35', pair: 'tok_1234567890abcdef' } })
  const opened = hostOpenHs1(host, JSON.parse(JSON.stringify(msg)))
  const hs2 = hostFinishHs2(host, opened, reply)
  const fin = clientFinishHs2(state, JSON.parse(JSON.stringify(hs2.msg)))
  return { host, client, opened, hostKeys: hs2.keys, clientKeys: fin.keys, payload: fin.payload }
}

describe('x25519 primitives', () => {
  it('derives the public key from a raw private key and agrees on DH', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    expect(keyPairFromPrivate(a.priv).pub).toEqual(a.pub)
    expect(dh(a.priv, b.pub)).toEqual(dh(b.priv, a.pub))
  })

  it('rejects a low-order public key', () => {
    expect(() => dh(generateKeyPair().priv, new Uint8Array(32))).toThrow(HandshakeError)
  })

  it('AEAD detects tampering of ciphertext and AAD', () => {
    const key = new Uint8Array(32).fill(1)
    const ct = seal(key, counterNonce(3), new TextEncoder().encode('hello'), Uint8Array.of(9))
    expect(new TextDecoder().decode(open(key, counterNonce(3), ct, Uint8Array.of(9)))).toBe('hello')
    const bad = Uint8Array.from(ct)
    bad[0] ^= 1
    expect(() => open(key, counterNonce(3), bad, Uint8Array.of(9))).toThrow()
    expect(() => open(key, counterNonce(3), ct, Uint8Array.of(8))).toThrow()
    expect(() => open(key, counterNonce(4), ct, Uint8Array.of(9))).toThrow()
  })

  it('counter nonce is 64-bit little endian', () => {
    expect(Array.from(counterNonce(0x0102))).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('handshake', () => {
  it('both sides derive the same keys and the host learns the client identity', () => {
    const r = handshake()
    expect(r.clientKeys).toEqual(r.hostKeys)
    expect(r.opened.clientStatic).toEqual(r.client.pub)
    expect(r.opened.payload.pair).toBe('tok_1234567890abcdef')
    expect(r.payload).toEqual(reply)
  })

  it('a client without the static private key cannot finish', () => {
    const host = generateKeyPair()
    const victim = generateKeyPair()
    const attacker = generateKeyPair()
    // Attacker claims the victim's public key but only holds its own private key.
    const { msg, state } = clientHs1({ hostPub: host.pub, clientStatic: { pub: victim.pub, priv: attacker.priv }, payload: { name: 'x', platform: 'y' } })
    const opened = hostOpenHs1(host, msg)
    expect(opened.clientStatic).toEqual(victim.pub)
    const hs2 = hostFinishHs2(host, opened, reply)
    expect(() => clientFinishHs2(state, hs2.msg)).toThrow()
  })

  it('hs1 for another host does not decrypt', () => {
    const { msg } = clientHs1({ hostPub: generateKeyPair().pub, clientStatic: generateKeyPair(), payload: { name: 'x', platform: 'y' } })
    expect(() => hostOpenHs1(generateKeyPair(), msg)).toThrowError(HandshakeError)
  })

  it('malformed hs1 is a bad handshake', () => {
    expect(() => hostOpenHs1(generateKeyPair(), { t: 'hs1', v: 1, e: 'AA', ct: 'AA' })).toThrowError(HandshakeError)
    expect(() => hostOpenHs1(generateKeyPair(), { t: 'hs1' })).toThrowError(HandshakeError)
  })

  it('each handshake yields fresh keys (ephemeral mixing)', () => {
    expect(handshake().clientKeys.c2s).not.toEqual(handshake().clientKeys.c2s)
  })
})

describe('secure channel', () => {
  it('round-trips small and deflated frames in both directions', () => {
    const { hostKeys, clientKeys } = handshake()
    const host = SecureChannel.forHost(hostKeys)
    const client = SecureChannel.forClient(clientKeys)
    const big = { k: 'evt', text: '流式输出'.repeat(2000) }
    const f1 = client.encrypt({ k: 'req', id: '1' })
    const f2 = client.encrypt(big)
    expect(f1[0]).toBe(0)
    expect(f2[0]).toBe(1)
    expect(f2.length).toBeLessThan(JSON.stringify(big).length / 4)
    expect(host.decrypt(f1)).toEqual({ k: 'req', id: '1' })
    expect(host.decrypt(f2)).toEqual(big)
    expect(client.decrypt(host.encrypt({ ok: true }))).toEqual({ ok: true })
  })

  it('rejects replayed, reordered, flag-flipped and unknown-flag frames', () => {
    const { hostKeys, clientKeys } = handshake()
    const client = SecureChannel.forClient(clientKeys)
    const a = client.encrypt({ n: 1 })
    const b = client.encrypt({ n: 2 })

    const reordered = SecureChannel.forHost(hostKeys)
    expect(() => reordered.decrypt(b)).toThrow()

    const replay = SecureChannel.forHost(hostKeys)
    expect(replay.decrypt(a)).toEqual({ n: 1 })
    expect(() => replay.decrypt(a)).toThrow()

    const flipped = Uint8Array.from(a)
    flipped[0] = 1
    expect(() => SecureChannel.forHost(hostKeys).decrypt(flipped)).toThrow()
    const unknown = Uint8Array.from(a)
    unknown[0] = 4
    expect(() => SecureChannel.forHost(hostKeys).decrypt(unknown)).toThrow()
  })

  it('a failed frame does not advance the counter', () => {
    const { hostKeys, clientKeys } = handshake()
    const client = SecureChannel.forClient(clientKeys)
    const host = SecureChannel.forHost(hostKeys)
    const a = client.encrypt({ n: 1 })
    const broken = Uint8Array.from(a)
    broken[5] ^= 0xff
    expect(() => host.decrypt(broken)).toThrow()
    expect(host.decrypt(a)).toEqual({ n: 1 })
  })

  it('base64url keys survive the wire', () => {
    const k = generateKeyPair()
    expect(base64UrlDecode(base64UrlEncode(k.pub))).toEqual(k.pub)
  })
})
