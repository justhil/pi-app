// End-to-end against a real Chromium with the pi extension loaded (the "My Chrome" path, minus
// Electron). Opt-in: PI_CHROME_EXE=<chromium or chrome-for-testing executable> npx vitest run …
// (branded Chrome ignores --load-extension; use Chromium / Chrome for Testing).

import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeBrowserTool, type ToolResult } from '../agent/tools'
import { ChromeBridge } from './bridge'
import { ChromeHost } from './chrome-host'

const EXE = process.env.PI_CHROME_EXE
const TOKEN = 'e2e-token-0123456789'

const PAGE = (framePort: number) => `<!doctype html><html><body>
<h1>Shop</h1>
<button id="save" onclick="const t=document.createElement('div');t.textContent='Saved successfully';document.body.append(t);setTimeout(()=>t.remove(),300);fetch('/api/save',{method:'POST'})">Save</button>
<button onclick="alert('Are you sure?')">Warn</button>
<ul>${Array.from({ length: 30 }, (_, i) => `<li><a href="/p/${i}">Product number ${i} with a fairly long name</a> <span>Price ${i}.00</span></li>`).join('')}</ul>
<iframe src="http://localhost:${framePort}/frame" width="400" height="120"></iframe>
</body></html>`
const FRAME = `<!doctype html><html><body><button onclick="this.textContent='Paid'">Pay</button></body></html>`

let server: Server
let frameServer: Server
let base = ''
let bridge: ChromeBridge
let host: ChromeHost
let close: () => Promise<void> = async () => undefined

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)))
const textOf = (r: ToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : `[image ${c.data.length}]`)).join('\n')
const call = (tool: string, args: unknown) => executeBrowserTool(host, { tool, args, sessionKey: 'e2e', cwd: process.cwd() })

describe.skipIf(!EXE)('My Chrome, real browser', () => {
  beforeAll(async () => {
    frameServer = createServer((_q, res) => res.end(FRAME))
    const framePort = await listen(frameServer)
    server = createServer((req, res) => {
      if (req.url === '/api/save') return res.writeHead(201).end('{"ok":true}')
      res.setHeader('content-type', 'text/html')
      res.end(PAGE(framePort))
    })
    base = `http://127.0.0.1:${await listen(server)}`
    bridge = new ChromeBridge({ token: () => TOKEN })
    const port = await bridge.start(39600)
    host = new ChromeHost(bridge, () => undefined)
    const { chromium } = await import('playwright-core')
    const ext = resolve('resources/chrome-extension')
    const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pi-chrome-')), {
      executablePath: EXE,
      headless: false,
      args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    })
    close = () => ctx.close()
    // Playwright auto-dismisses dialogs nobody listens to; keep them open like a real browser does.
    ctx.on('page', (page) => page.on('dialog', () => undefined))
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
    await sw.evaluate(([p, t]) => (globalThis as any).chrome.storage.local.set({ port: p, token: t }), [port, TOKEN] as const) // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < 100 && !bridge.connected(); i++) await new Promise((r) => setTimeout(r, 100))
  }, 60_000)

  afterAll(async () => {
    await close()
    bridge?.stop()
    server?.close()
    frameServer?.close()
  })

  it('pairs', () => {
    expect(bridge.connected()).toBe(true)
  })

  it('navigates, folds the list and acts with refs', async () => {
    const nav = textOf(await call('browser_navigate', { url: base }))
    expect(nav).toMatch(/button "Save" \[ref=e\d+\]/)
    const snap = textOf(await call('browser_snapshot', {}))
    expect(snap).toMatch(/… 27 more listitems/)
    const ref = /button "Save" \[ref=(e\d+)\]/.exec(snap)![1]
    const click = textOf(await call('browser_click', { target: ref }))
    expect(click).toMatch(/### Transient messages\n- Saved successfully/)
    expect(click).toMatch(/### Network\n#\d+ POST \/api\/save → 201/)
  }, 60_000)

  it('reaches into a cross-origin iframe', async () => {
    const snap = textOf(await call('browser_snapshot', {}))
    const ref = /button "Pay" \[ref=(f\d+e\d+)\]/.exec(snap)?.[1]
    expect(ref, snap).toBeTruthy()
    const out = textOf(await call('browser_click', { target: ref }))
    expect(out).toMatch(/Paid/)
  }, 60_000)

  it('sees and answers a page dialog', async () => {
    const snap = textOf(await call('browser_snapshot', {}))
    const ref = /button "Warn" \[ref=(e\d+)\]/.exec(snap)![1]
    const out = textOf(await call('browser_click', { target: ref }))
    expect(out).toMatch(/A alert dialog is open: "Are you sure\?"/)
    expect(textOf(await call('browser_handle_dialog', { accept: true }))).toMatch(/Accepted/)
  }, 60_000)

  it('shows and clears a help notification in Chrome', async () => {
    await expect(bridge.call('help.show', { id: 'e2e', title: 'pi', message: 'Please sign in', yes: 'Done', no: 'Give up' })).resolves.toBe(true)
    await expect(bridge.call('help.clear', { id: 'e2e' })).resolves.toBe(true)
  }, 30_000)

  it('saves a PDF from Chrome', async () => {
    expect(textOf(await call('browser_pdf_save', { filename: 'e2e-page' }))).toMatch(/Saved PDF \(\d+ KB\): .*e2e-page\.pdf/)
  }, 60_000)

  it('reaches into a closed shadow root with a raw DevTools command', async () => {
    await call('browser_evaluate', { world: 'main', function: '() => { const h = document.createElement("div"); h.id = "closed-host"; document.body.append(h); h.attachShadow({ mode: "closed" }).innerHTML = "<button>Hidden inside</button>"; return true }' })
    const doc = JSON.parse(textOf(await call('browser_cdp', { method: 'DOM.getDocument', params: { depth: 0 } })))
    const host = JSON.parse(textOf(await call('browser_cdp', { method: 'DOM.querySelector', params: { nodeId: doc.root.nodeId, selector: '#closed-host' } })))
    const out = textOf(await call('browser_cdp', { method: 'DOM.describeNode', params: { nodeId: host.nodeId, depth: 3, pierce: true } }))
    expect(out).toMatch(/"shadowRootType":"closed"/)
    expect(out).toMatch(/Hidden inside/)
    expect(textOf(await call('browser_cdp', { method: 'Runtime.enable' }))).toMatch(/browser_denied/)
  }, 60_000)

  it('takes a full-page screenshot', async () => {
    const out = textOf(await call('browser_take_screenshot', { fullPage: true }))
    expect(out).toMatch(/\[image \d+\][\s\S]*Full-page screenshot \d+×\d+/)
  }, 60_000)
})
