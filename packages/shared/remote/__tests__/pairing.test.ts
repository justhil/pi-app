import { describe, expect, it } from 'vitest'
import { base64UrlDecode, base64UrlEncode, decodePairLink, encodePairLink, isAllowedEndpoint, isPrivateHost, type PairOffer } from '../pairing'

const offer: PairOffer = {
  v: 1,
  hostId: 'h_1',
  hostName: '桌面',
  hostPub: base64UrlEncode(new Uint8Array(32).fill(7)),
  endpoints: ['ws://192.168.1.23:47900'],
  pairToken: 'tok_abcdefghijklmnop',
  exp: 1791205800000,
}

describe('pair link', () => {
  it('round-trips, including non-ASCII host names', () => {
    const link = encodePairLink(offer)
    expect(link.startsWith('pidesk://pair#')).toBe(true)
    expect(link.slice('pidesk://pair#'.length)).not.toMatch(/[+/=]/)
    expect(decodePairLink(`  ${link}\n`)).toEqual(offer)
  })

  it('returns null for other text and throws for a malformed link', () => {
    expect(decodePairLink('https://example.com')).toBeNull()
    expect(() => decodePairLink('pidesk://pair#bm90LWpzb24')).toThrow()
    expect(() => decodePairLink('pidesk://pair#' + base64UrlEncode(new TextEncoder().encode('{"v":1}')))).toThrow()
  })

  it('base64url handles every padding length', () => {
    for (let n = 0; n < 8; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 0xff)
      expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes)
    }
  })
})

describe('private hosts', () => {
  it.each(['10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.23', '100.101.102.103', '127.0.0.1', '169.254.1.1', 'fd12:3456::1', '[fe80::1]', '::1', 'pc.tail1234.ts.net', 'my-box.tail-ab.ts.net.'])(
    'allows %s',
    (h) => expect(isPrivateHost(h)).toBe(true),
  )
  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.1.1', 'example.com', '2001:db8::1', '999.1.1.1', 'ts.net', 'evil.ts.net.example.com', '-x.ts.net'])('rejects %s', (h) =>
    expect(isPrivateHost(h)).toBe(false),
  )
  it('endpoint must be ws:// with a port and private host', () => {
    expect(isAllowedEndpoint('ws://192.168.1.23:47900')).toBe(true)
    expect(isAllowedEndpoint('wss://192.168.1.23:47900')).toBe(false)
    expect(isAllowedEndpoint('ws://192.168.1.23')).toBe(false)
    expect(isAllowedEndpoint('ws://8.8.8.8:47900')).toBe(false)
    expect(isAllowedEndpoint('ws://pc.tail1234.ts.net:47900')).toBe(true)
  })
})
