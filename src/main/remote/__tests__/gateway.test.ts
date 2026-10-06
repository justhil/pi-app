import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { base64UrlDecode, decodePairLink, type OpenResult, type PairOffer, type TurnPatch } from '@shared/remote'
import { HandshakeError, generateKeyPair } from '@shared/remote/crypto'
import { RemoteGateway, hostAddresses, lanAddresses } from '../gateway'
import { remoteTap } from '../tap'
import { FakeHost } from '../testing/fake-host'
import { NodeRemoteClient, RemoteRpcError } from '../testing/node-client'

let host: FakeHost
let gw: RemoteGateway
let session: string
const clients: NodeRemoteClient[] = []

async function offer(): Promise<PairOffer> {
  const link = gw.regeneratePairing()!.link
  return decodePairLink(link)!
}

async function pairNew(name = 'phone'): Promise<NodeRemoteClient> {
  const o = await offer()
  const c = new NodeRemoteClient(generateKeyPair(), name)
  await c.connect(o.endpoints[0], base64UrlDecode(o.hostPub), o.pairToken)
  clients.push(c)
  return c
}

async function reconnect(c: NodeRemoteClient): Promise<NodeRemoteClient> {
  const o = await offer()
  const next = new NodeRemoteClient(c.identity, c.name)
  await next.connect(o.endpoints[0], base64UrlDecode(o.hostPub))
  clients.push(next)
  return next
}

const patchesOf = (c: NodeRemoteClient): TurnPatch[] =>
  c.events.filter((e) => e.m === 'turn.patch').flatMap((e) => (e.p as { patches: TurnPatch[] }).patches)

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

beforeEach(async () => {
  host = new FakeHost({ projects: ['/work/pi-app', '/work/secret'] })
  host.store.set('remote', { enabled: true, port: 47900, hostId: 'h_test', devices: [], projects: ['/work/pi-app'] })
  session = host.addSession('/work/pi-app', '修复登录', [
    { user: '查 401', answer: '是并发刷新。', tools: [{ name: 'read', args: { path: 'src/auth.ts' }, output: 'code' }] },
    { user: '修一下', answer: '修好了。' },
  ])
  host.addSession('/work/secret', '机密', [{ user: 'x', answer: 'y' }])
  gw = new RemoteGateway(host)
  gw.endpointHosts = () => [{ host: '127.0.0.1', kind: 'lan' }]
  await gw.start({ port: 0, host: '127.0.0.1' })
  host.sink = gw.sink
})

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
  await gw.stop()
  host.dispose()
})

describe('pairing and authentication', () => {
  it('pairs with a fresh token, then reconnects without one', async () => {
    const c = await pairNew()
    expect(c.hello).toMatchObject({ hostId: 'h_test', role: 'operator', epoch: gw.hub.epoch })
    const hello = await c.call('host.hello', { app: { name: 't', version: '1', platform: 'node' }, caps: { templates: [], piUi: [], uiKinds: [] } })
    expect(hello).toMatchObject({ hostName: 'fake-desktop', deviceId: c.hello!.deviceId })
    await c.close()
    const again = await reconnect(c)
    expect(again.hello!.deviceId).toBe(c.hello!.deviceId)
  })

  it('a used, replaced or expired token is refused; unknown devices are unpaired', async () => {
    const o = await offer()
    await new NodeRemoteClient(generateKeyPair()).connect(o.endpoints[0], base64UrlDecode(o.hostPub), o.pairToken).then((h) => h)
    const second = new NodeRemoteClient(generateKeyPair())
    await expect(second.connect(o.endpoints[0], base64UrlDecode(o.hostPub), o.pairToken)).rejects.toMatchObject({ code: 'pair_used' })

    const old = await offer()
    const fresh = await offer()
    await expect(new NodeRemoteClient(generateKeyPair()).connect(fresh.endpoints[0], base64UrlDecode(fresh.hostPub), old.pairToken)).rejects.toMatchObject({ code: 'pair_used' })

    await expect(new NodeRemoteClient(generateKeyPair()).connect(fresh.endpoints[0], base64UrlDecode(fresh.hostPub))).rejects.toBeInstanceOf(HandshakeError)
  })

  it('expired token', async () => {
    let now = Date.now()
    await gw.stop()
    gw = new RemoteGateway(host, () => now)
    gw.endpointHosts = () => [{ host: '127.0.0.1', kind: 'lan' }]
    await gw.start({ port: 0, host: '127.0.0.1' })
    const o = decodePairLink(gw.regeneratePairing()!.link)!
    now += 6 * 60_000
    await expect(new NodeRemoteClient(generateKeyPair()).connect(o.endpoints[0], base64UrlDecode(o.hostPub), o.pairToken)).rejects.toMatchObject({ code: 'pair_expired' })
  })

  it('revoked devices are disconnected and refused', async () => {
    const c = await pairNew()
    expect(gw.revokeDevice(c.hello!.deviceId)).toBe(true)
    await settle()
    expect(c.closeCode).toBe(4006)
    await expect(reconnect(c)).rejects.toMatchObject({ code: 'revoked' })
  })

  it('only hs1/hs2 travel as text; everything after is binary ciphertext', async () => {
    const c = await pairNew()
    await c.call('project.list', {})
    await c.call('session.open', { sessionKey: session })
    const text = c.rawFrames.filter((f) => !f.binary)
    expect(text).toHaveLength(1)
    expect(JSON.parse(text[0].bytes.toString()).t).toBe('hs2')
    for (const f of c.rawFrames.filter((x) => x.binary)) expect(f.bytes.includes(Buffer.from('修复登录'))).toBe(false)
  })

  it('plaintext or tampered frames after the handshake close the socket', async () => {
    const c = await pairNew()
    c.sendRaw('{"v":1,"k":"req","id":"x","m":"project.list","p":{}}', false)
    await settle()
    expect(c.closeCode).toBe(4002)
    const d = await pairNew()
    d.sendRaw(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]), true)
    await settle()
    expect(d.closeCode).toBe(4002)
  })
})

describe('sessions', () => {
  it('lists only whitelisted projects and refuses others', async () => {
    const c = await pairNew()
    expect((await c.call('project.list', {})).projects).toEqual([{ id: '/work/pi-app', name: 'pi-app' }])
    const { sessions } = await c.call('session.watchList', {})
    expect(sessions.map((s) => s.title)).toEqual(['修复登录'])
    const secret = [...host.sessions.keys()].find((k) => k.includes('secret'))!
    await expect(c.call('session.open', { sessionKey: secret })).rejects.toMatchObject({ err: { code: 'forbidden' } })
    await expect(c.call('session.watchList', { projectId: '/work/secret' })).rejects.toBeInstanceOf(RemoteRpcError)
  })

  it('opens a snapshot, streams a run, and replays from a cursor after reconnect', async () => {
    const c = await pairNew()
    const open = (await c.call('session.open', { sessionKey: session })) as OpenResult
    expect(open.kind).toBe('snapshot')
    expect(open.turns!.map((t) => t.answer)).toEqual(['是并发刷新。', '修好了。'])
    expect(open.turns![0].activity.counts.read).toBe(1)

    await c.call('turn.send', { sessionKey: session, text: '再跑一遍测试', mode: 'prompt', clientMessageId: 'm_00000001' })
    await settle(200)
    const patches = patchesOf(c)
    expect(patches.map((p) => p.op)).toContain('turn.settle')
    const seqs = patches.map((p) => p.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    const lastSeq = seqs[seqs.length - 1]

    // Reconnect with the cursor of the middle of the run → replay of the remainder.
    await c.close()
    const d = await reconnect(c)
    const replay = (await d.call('session.open', { sessionKey: session, cursor: { epoch: open.epoch, seq: seqs[2] } })) as OpenResult
    expect(replay.kind).toBe('replay')
    expect(replay.patches!.map((p) => p.seq)[0]).toBe(seqs[3])
    expect(replay.seq).toBe(lastSeq)

    // A foreign epoch forces a snapshot with a resync reason.
    const resync = (await d.call('session.open', { sessionKey: session, cursor: { epoch: 'e_other', seq: 3 } })) as OpenResult
    expect(resync).toMatchObject({ kind: 'snapshot', resync: 'epoch_changed' })
    expect(resync.turns!.at(-1)!.answer).toBe('全部通过，没有回归。')
  })

  it('coalesced text appends keep a gap-free sequence via seqTo', async () => {
    const c = await pairNew()
    await c.call('session.open', { sessionKey: session })
    await host.playRun(session, 'go') // synchronous: every append lands in one flush window
    await settle(200)
    const patches = patchesOf(c)
    const merged = patches.find((p) => p.op === 'text.append' && p.seqTo !== undefined)
    expect(merged).toBeDefined()
    let expected = patches[0].seq
    for (const p of patches) {
      expect(p.seq).toBe(expected)
      expected = (p.op === 'text.append' && p.seqTo !== undefined ? p.seqTo : p.seq) + 1
    }
  })

  it('turn.send is idempotent per clientMessageId and forwards session capabilities', async () => {
    host.capabilities[session] = ['pi-ui']
    const c = await pairNew()
    const a = await c.call('turn.send', { sessionKey: session, text: '补充', mode: 'steer', clientMessageId: 'm_dupe0001' })
    const b = await c.call('turn.send', { sessionKey: session, text: '补充', mode: 'steer', clientMessageId: 'm_dupe0001' })
    expect(a).toEqual({ accepted: true })
    expect(b).toEqual({ accepted: true, duplicate: true })
    expect(host.calls.sent).toEqual([{ sessionFile: session, text: '补充', mode: 'steer', capabilities: ['pi-ui'] }])
  })

  it('dequeue and abort pull queued messages back', async () => {
    const c = await pairNew()
    ;(host as unknown as { sessions: Map<string, { running: boolean }> }).sessions.get(session)!.running = true
    await c.call('turn.send', { sessionKey: session, text: '先改测试', mode: 'steer', clientMessageId: 'm_queue001' })
    await c.call('turn.send', { sessionKey: session, text: '再更新文档', mode: 'followUp', clientMessageId: 'm_queue002' })
    expect(await c.call('turn.dequeue', { sessionKey: session })).toEqual({ restored: ['先改测试', '再更新文档'] })
    expect(await c.call('turn.dequeue', { sessionKey: session })).toEqual({ restored: [] })
    await c.call('turn.send', { sessionKey: session, text: '最后提交', mode: 'followUp', clientMessageId: 'm_queue003' })
    expect(await c.call('turn.abort', { sessionKey: session })).toEqual({ aborted: true, restored: ['最后提交'] })
    expect(host.calls.aborted).toEqual([session])
  })

  it('lists slash commands for the session project', async () => {
    const c = await pairNew()
    const r = (await c.call('command.list', { sessionKey: session })) as { commands: { name: string; category: string }[] }
    expect(r.commands.map((x) => x.name)).toContain('/skill:pdf')
    expect(new Set(r.commands.map((x) => x.category))).toEqual(new Set(['prompt', 'skill', 'extension']))
  })

  it('browses and searches project files', async () => {
    const c = await pairNew()
    const root = (await c.call('file.list', { sessionKey: session, path: '.' })) as { entries: { name: string; dir: boolean }[] }
    expect(root.entries.map((e) => e.name)).toEqual(['docs', 'src', 'package.json', 'README.md'])
    const src = (await c.call('file.list', { sessionKey: session, path: 'src' })) as { entries: { path: string }[] }
    expect(src.entries.map((e) => e.path)).toEqual(['src/main', 'src/auth.ts', 'src/index.ts'])
    await expect(c.call('file.list', { sessionKey: session, path: '../etc' })).rejects.toMatchObject({ err: { code: 'not_found' } })
    const found = (await c.call('file.search', { sessionKey: session, query: 'AUTH' })) as { entries: { path: string }[] }
    expect(found.entries.map((e) => e.path)).toEqual(['src/auth.ts'])
  })

  it('rewinds to before a user message and tells viewers to re-open', async () => {
    const c = await pairNew()
    const open = (await c.call('session.open', { sessionKey: session })) as { turns: { anchor: string; user: { text: string } }[] }
    const last = open.turns[open.turns.length - 1]
    expect(await c.call('turn.rewind', { sessionKey: session, anchor: last.anchor })).toEqual({ editorText: last.user.text })
    await settle()
    expect(patchesOf(c).map((p) => p.op)).toContain('timeline.reset')
    expect(host.calls.settingsNotified).toContain('rewound')
    const again = (await c.call('session.open', { sessionKey: session })) as { turns: unknown[] }
    expect(again.turns).toHaveLength(open.turns.length - 1)
  })

  it('refuses to rewind while running', async () => {
    const c = await pairNew()
    await c.call('session.open', { sessionKey: session })
    const h = host as unknown as { emit(e: unknown): void; base(f: string): object }
    h.emit({ ...h.base(session), type: 'run', phase: 'running' })
    await expect(c.call('turn.rewind', { sessionKey: session, anchor: 'x' })).rejects.toMatchObject({ err: { code: 'busy' } })
  })

  it('reports context usage for the session panel', async () => {
    const c = await pairNew()
    const r = (await c.call('session.stats', { sessionKey: session })) as { context: { tokens: number; window: number; breakdown: unknown[] } }
    expect(r.context.window).toBe(200_000)
    expect(r.context.tokens).toBeGreaterThan(0)
    expect(r.context.breakdown).toHaveLength(4)
  })

  it('viewers cannot write', async () => {
    const c = await pairNew()
    gw.setDeviceRole(c.hello!.deviceId, 'viewer')
    await expect(c.call('turn.send', { sessionKey: session, text: 'x', mode: 'prompt', clientMessageId: 'm_viewer01' })).rejects.toMatchObject({ err: { code: 'forbidden' } })
    await expect(c.call('settings.cacheWarming.set', { mode: 'idle' })).rejects.toMatchObject({ err: { code: 'forbidden' } })
    expect((await c.call('session.open', { sessionKey: session })).kind).toBe('snapshot')
  })

  it('pages older turns by anchor and fetches tool detail', async () => {
    for (let i = 0; i < 25; i++) host.sessions.get(session)!.items.push({ id: `x${i}`, type: 'user-message', text: `q${i}`, sessionEntryId: `q${i}`, timestamp: 9e12 + i })
    const c = await pairNew()
    const open = (await c.call('session.open', { sessionKey: session })) as OpenResult
    expect(open.turns).toHaveLength(20)
    expect(open.hasOlder).toBe(true)
    const older = await c.call('turn.page', { sessionKey: session, before: open.turns![0].anchor, limit: 20 })
    expect(older.turns.map((t) => t.user.text).slice(0, 2)).toEqual(['查 401', '修一下'])
    expect(older.hasOlder).toBe(false)
    const toolCallId = older.turns[0].steps.find((s) => s.kind === 'tool')!
    const detail = await c.call('turn.toolDetail', { sessionKey: session, toolCallId: (toolCallId as { toolCallId: string }).toolCallId })
    expect(detail.node.template).toBe('read')
  })

  it('pushes inbox updates when a session runs', async () => {
    const c = await pairNew()
    await c.call('session.watchList', {})
    await host.playRun(session, 'go')
    const update = await c.waitFor((e) => e.m === 'sessions.update', 3000)
    expect((update.p as { sessions: Array<{ sessionKey: string }> }).sessions[0].sessionKey).toBe(session)
  })

  it('creates sessions in the background only in allowed projects', async () => {
    const c = await pairNew()
    const created = await c.call('session.create', { projectId: '/work/pi-app', capabilities: ['pi-ui', 'nope'] })
    expect(host.calls.created).toEqual([created.sessionKey])
    expect(host.capabilities[created.sessionKey]).toEqual(['pi-ui'])
    await expect(c.call('session.create', { projectId: '/work/secret' })).rejects.toMatchObject({ err: { code: 'forbidden' } })
  })

  it('a phone-created session opens empty, streams its first run, then tells the desktop list', async () => {
    const c = await pairNew()
    const { sessionKey } = await c.call('session.create', { projectId: '/work/pi-app' })
    const opened = await c.call('session.open', { sessionKey })
    expect(opened).toMatchObject({ kind: 'snapshot', turns: [] })
    expect(host.calls.sessionsNotified).toEqual([])
    await c.call('turn.send', { sessionKey, text: '你好', mode: 'prompt', clientMessageId: 'm-new-session-1' })
    await c.waitFor((e) => e.m === 'turn.patch' && JSON.stringify(e.p).includes('turn.settle'))
    expect(patchesOf(c).some((p) => p.op === 'turn.upsert')).toBe(true)
    expect(host.calls.sessionsNotified).toEqual(['/work/pi-app'])
    const models = await c.call('model.list', { sessionKey })
    expect(models.availableThinking.length).toBeGreaterThan(0)
  })

  it('stores uploaded attachments on the host and returns a prompt path', async () => {
    const c = await pairNew()
    const r = await c.call('attachment.upload', { name: 'IMG 1.jpg', mime: 'image/jpeg', data: Buffer.from('jpegbytes').toString('base64') })
    expect(r).toMatchObject({ name: 'IMG 1.jpg', size: 9 })
    expect(Buffer.from(host.attachments.get(r.path)!).toString()).toBe('jpegbytes')
    const back = await c.call('attachment.get', { path: r.path })
    expect(Buffer.from(back.data, 'base64').toString()).toBe('jpegbytes')
    await expect(c.call('attachment.get', { path: '/etc/passwd' })).rejects.toMatchObject({ err: { code: 'not_found' } })
  })

  it('never calls desktop-focus APIs', () => {
    expect(host.calls.forbidden).toEqual([])
  })
})

describe('extension UI', () => {
  it('first answer wins: remote answer dismisses desktop and other phones', async () => {
    const a = await pairNew('a')
    const b = await pairNew('b')
    await a.call('session.open', { sessionKey: session })
    await b.call('session.open', { sessionKey: session })
    void host.playRun(session, '问我一下', { ask: true })
    const req = await a.waitFor((e) => e.m === 'ui.request')
    const id = (req.p as { id: string }).id
    await b.waitFor((e) => e.m === 'ui.request')
    expect((await a.call('ui.respond', { id, result: { cancelled: false, answers: [] } })).accepted).toBe(true)
    expect((await b.call('ui.respond', { id, cancelled: true })).accepted).toBe(false)
    const dismiss = await b.waitFor((e) => e.m === 'ui.dismiss')
    expect(dismiss.p).toMatchObject({ id, by: 'remote' })
    expect(host.calls.responded).toHaveLength(1)
    expect(host.calls.dismissedDesktop).toEqual([id])
  })

  it('desktop answer dismisses phones; pending questions are part of the snapshot and inbox', async () => {
    const a = await pairNew()
    await a.call('session.watchList', {})
    remoteTap.uiRequest({ id: 'q1', method: 'confirm', title: '删除？', message: '3 个文件', sessionFile: session })
    // tap sink is the gateway (set on start)
    const open = (await a.call('session.open', { sessionKey: session })) as OpenResult
    expect(open.pendingUi.map((u) => u.id)).toEqual(['q1'])
    const upd = await a.waitFor((e) => e.m === 'sessions.update', 3000)
    expect((upd.p as { sessions: Array<{ status: string; preview?: string }> }).sessions[0]).toMatchObject({ status: 'needsInput', preview: '删除？' })
    remoteTap.uiResolved('q1', 'desktop')
    const d = await a.waitFor((e) => e.m === 'ui.dismiss')
    expect(d.p).toMatchObject({ id: 'q1', by: 'desktop' })
  })

  it('unknown request kinds are not forwarded', async () => {
    const a = await pairNew()
    await a.call('session.open', { sessionKey: session })
    remoteTap.uiRequest({ id: 'weird', method: 'custom', kind: 'something_new', sessionFile: session })
    await settle()
    expect(a.events.some((e) => e.m === 'ui.request')).toBe(false)
  })
})

describe('settings', () => {
  it('capabilities and cache warming round-trip and notify the desktop', async () => {
    const c = await pairNew()
    const list = await c.call('capability.list', { sessionKey: session })
    expect(list.capabilities.map((x) => [x.id, x.enabled, x.promptTokens])).toEqual([
      ['pi-ui', false, 2410],
      ['browser', false, 3100],
    ])
    expect(await c.call('capability.set', { sessionKey: session, id: 'pi-ui', on: true })).toEqual({ enabled: ['pi-ui'] })
    await expect(c.call('capability.set', { sessionKey: session, id: 'rm-rf', on: true })).rejects.toMatchObject({ err: { code: 'bad_request' } })
    expect(await c.call('settings.cacheWarming.set', { mode: 'idle' })).toEqual({ mode: 'idle' })
    expect(await c.call('settings.cacheWarming.get', {})).toEqual({ mode: 'idle' })
    expect(host.calls.settingsNotified).toEqual(['capabilities', 'cacheWarming'])
  })

  it('desktop setting changes reach connected phones', async () => {
    const c = await pairNew()
    remoteTap.settingsChanged('cacheWarming')
    const e = await c.waitFor((x) => x.m === 'settings.changed')
    expect(e.p).toEqual({ key: 'cacheWarming' })
  })

  it('rejects unknown methods and bad params', async () => {
    const c = await pairNew()
    await expect(c.call('session.setPendingBind' as never, {} as never)).rejects.toMatchObject({ err: { code: 'not_supported' } })
    await expect(c.call('turn.page', { sessionKey: session, before: 'x', limit: 999 })).rejects.toMatchObject({ err: { code: 'bad_request' } })
    expect(await c.ping()).toBeNull()
  })
})

describe('lanAddresses', () => {
  const nic = (address: string) => [{ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '', cidr: null }] as never
  it('skips container, VPN and TUN adapters and orders home LAN first', () => {
    const out = lanAddresses({
      docker0: nic('172.17.0.1'),
      Meta: nic('198.18.0.1'),
      tun0: nic('10.8.0.2'),
      'br-1a2b': nic('172.18.0.1'),
      eth0: nic('10.0.0.5'),
      wlan0: nic('192.168.1.23'),
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] as never,
    })
    expect(out).toEqual(['192.168.1.23', '10.0.0.5'])
  })
  it('keeps mesh overlays after the LAN, but not proxy TUN fake-ips', () => {
    const out = hostAddresses({
      utun3: nic('100.101.7.8'), // Tailscale on macOS
      utun4: nic('198.18.0.1'), // Clash TUN on macOS
      tailscale0: nic('100.64.0.9'),
      zt5u4y: nic('10.147.17.3'), // ZeroTier
      wg0: nic('10.66.0.2'),
      docker0: nic('172.17.0.1'),
      wlan0: nic('192.168.1.23'),
    })
    expect(out).toEqual([
      { host: '192.168.1.23', kind: 'lan' },
      { host: '100.101.7.8', kind: 'tailscale' },
      { host: '100.64.0.9', kind: 'tailscale' },
      { host: '10.147.17.3', kind: 'overlay' },
      { host: '10.66.0.2', kind: 'overlay' },
    ])
  })
})
