import { readFileSync } from 'node:fs'
import { base64UrlDecode, decodePairLink, type OpenResult, type TurnPatch } from '../../packages/shared/remote'
import { generateKeyPair } from '../../packages/shared/remote/crypto'
import { NodeRemoteClient } from '../../src/main/remote/testing/node-client'

/**
 * No-phone end-to-end check against a running gateway (dev host or real desktop):
 * pair → hello → list → open → send → stream until settled → reconnect with cursor.
 *   node scripts/remote-probe.mjs [pairing-link]
 * Without an argument the link is read from PI_REMOTE_PAIR_FILE (dev host default).
 */

const pairFile = process.env.PI_REMOTE_PAIR_FILE || 'node_modules/.cache/remote-dev/pair.json'
const link = process.argv[2] || (JSON.parse(readFileSync(pairFile, 'utf8')) as { link: string }).link
const offer = decodePairLink(link)
if (!offer) throw new Error('not a pairing link')

const step = (msg: string) => console.log(`  ✓ ${msg}`)
const fail = (msg: string): never => {
  console.error(`  ✗ ${msg}`)
  process.exit(1)
}
const patchesOf = (c: NodeRemoteClient): TurnPatch[] => c.events.filter((e) => e.m === 'turn.patch').flatMap((e) => (e.p as { patches: TurnPatch[] }).patches)

const identity = generateKeyPair()
const endpoint = offer.endpoints.find((e) => e.includes('127.0.0.1')) ?? offer.endpoints[0]
console.log(`probe → ${endpoint}`)

const c1 = new NodeRemoteClient(identity, 'probe')
const hs = await c1.connect(endpoint, base64UrlDecode(offer.hostPub), offer.pairToken)
step(`paired as ${hs.deviceId} (${hs.role}) on ${hs.hostName}`)
const hello = await c1.call('host.hello', { app: { name: 'probe', version: '1', platform: 'node' }, caps: { templates: [], piUi: [], uiKinds: [] } })
step(`hello: epoch ${hello.epoch}, features ${hello.features.join(',')}, assets ${hello.assets.map((a) => a.name).join(',') || '-'}`)
const { projects } = await c1.call('project.list', {})
if (!projects.length) fail('no projects whitelisted')
step(`projects: ${projects.map((p) => p.name).join(', ')}`)
const { sessions } = await c1.call('session.watchList', {})
if (!sessions.length) fail('no sessions')
step(`inbox: ${sessions.length} sessions, first "${sessions[0].title}" (${sessions[0].status})`)
const target = sessions[sessions.length - 1]
const open = (await c1.call('session.open', { sessionKey: target.sessionKey })) as OpenResult
step(`open "${open.title}": ${open.kind}, ${open.turns?.length ?? 0} turns, seq ${open.seq}`)

const sendAt = Date.now()
await c1.call('turn.send', { sessionKey: target.sessionKey, text: 'probe: 再跑一遍测试', mode: 'prompt', clientMessageId: `m_probe_${sendAt}` })
const dup = await c1.call('turn.send', { sessionKey: target.sessionKey, text: 'probe: 再跑一遍测试', mode: 'prompt', clientMessageId: `m_probe_${sendAt}` })
if (!dup.duplicate) fail('duplicate send was not detected')
step('send accepted; duplicate detected')
await c1.waitFor((e) => e.m === 'turn.patch' && (e.p as { patches: TurnPatch[] }).patches.some((p) => p.op === 'turn.settle'), 60_000).catch(() => fail('run did not settle'))
const patches = patchesOf(c1)
const seqs = patches.map((p) => p.seq)
if (seqs.some((s, i) => i > 0 && s <= seqs[i - 1])) fail(`patch seq not increasing: ${seqs.join(',')}`)
step(`streamed ${patches.length} patches in ${Date.now() - sendAt}ms: ${[...new Set(patches.map((p) => p.op))].join(', ')}`)

const midSeq = seqs[Math.floor(seqs.length / 2)]
await c1.close()
const c2 = new NodeRemoteClient(identity, 'probe')
await c2.connect(endpoint, base64UrlDecode(offer.hostPub))
step('reconnected with the device key (no pairing token)')
const resumed = (await c2.call('session.open', { sessionKey: target.sessionKey, cursor: { epoch: open.epoch, seq: midSeq } })) as OpenResult
if (resumed.kind !== 'replay') fail(`expected replay, got ${resumed.kind}`)
const replayed = resumed.patches!.map((p) => p.seq)
if (replayed[0] !== midSeq + 1 || replayed[replayed.length - 1] !== seqs[seqs.length - 1]) fail(`replay range wrong: ${replayed.join(',')}`)
step(`replay from seq ${midSeq}: ${replayed.length} patches, no gaps`)
await c2.close()
console.log('probe passed')
process.exit(0)
