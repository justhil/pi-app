import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { ChromeBridge } from './bridge'
import { ChromeHost } from './chrome-host'
import { cdpKey } from './keys'

let bridge: ChromeBridge | null = null
let ext: WebSocket | null = null

afterEach(() => {
  ext?.close()
  bridge?.stop()
  ext = null
  bridge = null
})

/** A fake pi extension: answers requests with `reply(method, params)`. */
async function pair(token: string, origin = 'chrome-extension://abc', reply: (method: string, params: { sessionKey?: string }) => unknown = () => null) {
  bridge = new ChromeBridge({ token: () => 'secret-token-123456' })
  const port = await bridge.start(39000 + Math.floor(Math.random() * 500))
  const ws = new WebSocket(`ws://127.0.0.1:${port}/chrome?token=${token}`, { origin })
  ext = ws
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
  const opened = await new Promise<boolean>((resolve) => {
    ws.on('open', () => resolve(true))
    ws.on('error', () => resolve(false))
  })
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data))
    if (msg.id !== undefined) ws.send(JSON.stringify({ id: msg.id, result: reply(msg.method, msg.params) }))
  })
  if (opened) ws.send(JSON.stringify({ event: 'hello', params: { version: '1.0.0', ua: 'Mozilla/5.0 Chrome/131.0.0.0', extensionId: 'abc' } }))
  return { ws, opened, closed }
}

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 10))
}

describe('ChromeBridge', () => {
  it('pairs an extension and relays requests', async () => {
    await pair('secret-token-123456', undefined, (method) => (method === 'ping' ? 'pong' : null))
    await until(() => !!bridge!.connected())
    expect(bridge!.hello?.extensionId).toBe('abc')
    expect(await bridge!.call('ping')).toBe('pong')
  })

  it('closes a wrong pairing code with 4401 and refuses web pages', async () => {
    const bad = await pair('nope')
    expect(await bad.closed).toBe(4401)
    bridge!.stop()
    const web = await pair('secret-token-123456', 'https://evil.test')
    expect(web.opened).toBe(false)
  })
})

describe('ChromeHost', () => {
  it('opens agent tabs, follows tab updates and lends user tabs', async () => {
    const tab = (tabId: number, extra: object = {}) => ({ tabId, windowId: 1, url: 'https://a.test/', title: 'A', loading: false, active: true, sessionKey: null, borrowed: false, agentWindow: false, ...extra })
    const { ws } = await pair('secret-token-123456', undefined, (method, p) => {
      if (method === 'tabs.create') return tab(7, { sessionKey: p.sessionKey, agentWindow: true })
      if (method === 'tabs.list') return [tab(7, { sessionKey: 's1' }), tab(9, { url: 'https://mail.test/', title: 'Mail' })]
      if (method === 'tabs.borrow') return tab(9, { sessionKey: p.sessionKey, borrowed: true })
      if (method === 'downloads.list') return []
      return true
    })
    await until(() => !!bridge!.connected())
    const host = new ChromeHost(bridge!, () => undefined)
    const info = await host.openTab({ url: 'https://a.test/', openedBy: { sessionKey: 's1' } })
    expect(info).toMatchObject({ tabId: 'chrome-7', engine: 'chrome', openedBy: { sessionKey: 's1' } })
    ws.send(JSON.stringify({ event: 'tab.updated', params: tab(7, { sessionKey: 's1', title: 'Renamed' }) }))
    await until(() => host.list().tabs[0]?.title === 'Renamed')
    expect(host.list().tabs[0].title).toBe('Renamed')
    expect(await host.userTabs()).toEqual([{ chromeTabId: 9, title: 'Mail', url: 'https://mail.test/' }])
    const lent = await host.borrow(9, 's1')
    expect(lent.tabId).toBe('chrome-9')
    await host.giveBack('chrome-9')
    expect(host.list().tabs.map((t) => t.tabId)).toEqual(['chrome-7'])
    ws.send(JSON.stringify({ event: 'tab.removed', params: { tabId: 7 } }))
    await until(() => host.list().tabs.length === 0)
    expect(host.list().tabs).toEqual([])
  })
})

describe('cdpKey', () => {
  it('maps keys, characters and chords', () => {
    expect(cdpKey('Enter')).toEqual({ key: 'Enter', code: 'Enter', keyCode: 13, text: '\r', modifiers: 0 })
    expect(cdpKey('a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a', modifiers: 0 })
    expect(cdpKey('Control+A', 'win32')).toMatchObject({ code: 'KeyA', modifiers: 2 })
    expect(cdpKey('Control+A', 'win32').text).toBeUndefined()
    expect(cdpKey('ControlOrMeta+K', 'darwin').modifiers).toBe(4)
    expect(cdpKey('Shift+Tab')).toMatchObject({ code: 'Tab', modifiers: 8 })
  })
})
