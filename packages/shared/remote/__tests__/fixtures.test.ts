import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecureChannel, clientFinishHs2, clientHs1, hostFinishHs2, hostOpenHs1, keyPairFromPrivate } from '../crypto'
import { messageFixtures } from '../fixtures'
import { base64UrlDecode, base64UrlEncode } from '../pairing'

/**
 * Golden files shared with the Kotlin client (apps/mobile). Regenerate with
 * `UPDATE_FIXTURES=1 npx vitest run packages/shared/remote`.
 */

const dir = resolve(__dirname, '../fixtures')
const update = process.env.UPDATE_FIXTURES === '1'
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => (seed + i * 7) & 0xff)

function cryptoVectors() {
  const hostStatic = keyPairFromPrivate(bytes(1))
  const clientStatic = keyPairFromPrivate(bytes(40))
  const clientEphemeral = keyPairFromPrivate(bytes(80))
  const hostEphemeral = keyPairFromPrivate(bytes(120))
  const hs1Payload = { name: 'Pixel 9', platform: 'android-35', pair: 'tok_0123456789abcdef' }
  const hs2Payload = { deviceId: 'd_77aa', hostId: 'h_9f2c', hostName: 'justhil-desktop', epoch: 'e_3b1f', role: 'operator' as const }
  const { msg: hs1, state } = clientHs1({ hostPub: hostStatic.pub, clientStatic, payload: hs1Payload, ephemeral: clientEphemeral })
  const opened = hostOpenHs1(hostStatic, hs1)
  const { msg: hs2, keys } = hostFinishHs2(hostStatic, opened, hs2Payload, hostEphemeral)
  clientFinishHs2(state, hs2)
  const client = SecureChannel.forClient(keys)
  const host = SecureChannel.forHost(keys)
  const small = { v: 1, k: 'req', id: 'c1', m: 'host.hello', p: { app: { name: 'pi-remote', version: '0.1.0', platform: 'android-35' } } }
  const big = { v: 1, k: 'evt', m: 'turn.patch', p: { text: '流式 markdown 输出 '.repeat(200) } }
  return {
    hostStaticPriv: base64UrlEncode(hostStatic.priv),
    hostStaticPub: base64UrlEncode(hostStatic.pub),
    clientStaticPriv: base64UrlEncode(clientStatic.priv),
    clientStaticPub: base64UrlEncode(clientStatic.pub),
    clientEphemeralPriv: base64UrlEncode(clientEphemeral.priv),
    hostEphemeralPriv: base64UrlEncode(hostEphemeral.priv),
    hs1Payload,
    hs1,
    hs2Payload,
    hs2,
    keys: { c2s: base64UrlEncode(keys.c2s), s2c: base64UrlEncode(keys.s2c) },
    /** Client → host frames 0 and 1 (frame 1 is deflated; compare plaintext, not bytes). */
    c2sFrames: [
      { plaintext: small, frame: base64UrlEncode(client.encrypt(small)) },
      { plaintext: big, frame: base64UrlEncode(client.encrypt(big)) },
    ],
    /** Host → client frame 0. */
    s2cFrames: [{ plaintext: { v: 1, k: 'res', id: 'c1', ok: true, p: {} }, frame: base64UrlEncode(host.encrypt({ v: 1, k: 'res', id: 'c1', ok: true, p: {} })) }],
  }
}

function expectedFiles(): Map<string, string> {
  const files = new Map<string, string>()
  for (const f of messageFixtures()) files.set(`messages/${f.name}.json`, json({ schema: f.schema, value: f.value }))
  files.set('crypto-vectors.json', json(cryptoVectors()))
  return files
}

describe('golden fixtures', () => {
  it('match the committed files', () => {
    const expected = expectedFiles()
    if (update) {
      rmSync(join(dir, 'messages'), { recursive: true, force: true })
      mkdirSync(join(dir, 'messages'), { recursive: true })
      for (const [name, content] of expected) writeFileSync(join(dir, name), content)
    }
    const committed = readdirSync(join(dir, 'messages')).map((n) => `messages/${n}`)
    expect(committed.sort()).toEqual([...expected.keys()].filter((k) => k.startsWith('messages/')).sort())
    for (const [name, content] of expected) {
      const actual = readFileSync(join(dir, name), 'utf8')
      if (name === 'crypto-vectors.json') {
        // Deflate output may differ between zlib builds; the frame must still decrypt to the same plaintext.
        const a = JSON.parse(actual)
        const e = JSON.parse(content)
        const host = SecureChannel.forHost({ c2s: base64UrlDecode(a.keys.c2s), s2c: base64UrlDecode(a.keys.s2c) })
        for (const f of a.c2sFrames) expect(host.decrypt(base64UrlDecode(f.frame))).toEqual(f.plaintext)
        a.c2sFrames[1].frame = e.c2sFrames[1].frame = ''
        expect(a, `${name} is stale — rerun with UPDATE_FIXTURES=1`).toEqual(e)
        continue
      }
      expect(actual, `${name} is stale — rerun with UPDATE_FIXTURES=1`).toBe(content)
    }
  })
})
