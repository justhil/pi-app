import { describe, expect, it } from 'vitest'
import type { BrowserTabInfo } from '@shared/browser-types'
import type { PageEngine } from '../engines/types'
import { Pointer } from './input'
import { executeBrowserTool, forgetBrowserTab, type AgentBrowserHost, type ToolResult } from './tools'

type Snap = { yaml: string; modal?: { description: string; behind: number } }

/** A page that answers the runtime calls the executor makes; snapshots come from a queue. */
function fakePage(snaps: Snap[], opts: { flashes?: string[]; failOn?: string } = {}) {
  const calls: string[] = []
  let taken = 0
  const engine = {
    id: 'electron',
    async run(expr: string) {
      calls.push(expr)
      if (opts.failOn && expr.includes(opts.failOn)) return { error: 'not_actionable', message: `${opts.failOn} is covered` }
      if (expr.startsWith('__piBrowser.snapshot(')) {
        const current = snaps[Math.min(taken++, snaps.length - 1)]
        return { url: 'https://shop.test/', title: 'Shop', yaml: current.yaml, truncated: false, refCount: 3, belowFold: { count: 0, screens: 0 }, covered: 0, gates: (current as { gates?: string[] }).gates ?? [], ...(current.modal ? { modal: current.modal } : {}) }
      }
      if (expr.startsWith('__piBrowser.transients.take')) return opts.flashes ?? []
      if (expr.startsWith('__piBrowser.actionable(')) return { point: { x: 50, y: 20 }, rect: { x: 40, y: 10, width: 20, height: 20 }, description: 'button "Go"', tag: 'button', inputType: '', editable: false, checked: null }
      if (expr.startsWith('__piBrowser.isFileTarget')) return false
      return true
    },
    async runMain() {
      return { value: null }
    },
    mouse: { move() {}, down() {}, up() {}, wheel() {} },
    keyboard: { async press() {}, async insertText() {} },
    async screenshot() {
      return { png: Buffer.alloc(0), width: 1, height: 1 }
    },
    async pdf() {
      return Buffer.alloc(0)
    },
    async navigate() {},
    async back() {
      return false
    },
    url: () => 'https://shop.test/',
    title: () => 'Shop',
    isLoading: () => false,
    logs: () => [],
    pendingRequests: () => 0,
    cdpTab: () => null,
  } as unknown as PageEngine
  const info = { tabId: 't1', url: 'https://shop.test/', title: 'Shop', loading: false, openedBy: { sessionKey: 's1' } } as unknown as BrowserTabInfo
  const pointer = new Pointer(engine)
  const host: AgentBrowserHost = {
    list: () => ({ tabs: [info], activeTabId: 't1' }),
    openTab: () => info,
    closeTab() {},
    focusTab() {},
    agentTab: () => ({ info, engine, pointer }),
    runOnTab: (_id, _action, work) => work(),
    downloads: () => [],
    kind: 'builtin',
    notify() {},
  }
  return { host, calls }
}

const textOf = (r: ToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n')
const call = (tool: string, args: unknown) => ({ tool, args, sessionKey: 's1', cwd: '' })

describe('act results', () => {
  it('reports flashed messages and grouped changes', async () => {
    forgetBrowserTab('t1')
    const { host } = fakePage([{ yaml: '- main [ref=e1]:\n  - button "Save" [ref=e2]' }, { yaml: '- main [ref=e1]:\n  - button "Save" [disabled] [ref=e2]' }], { flashes: ['Saved!'] })
    const out = textOf(await executeBrowserTool(host, call('browser_click', { target: 'e2' })))
    expect(out).toMatch(/### Transient messages\n- Saved!/)
    expect(out).toMatch(/### Changes\nin main \[ref=e1\]:\n {2}- button "Save" \[ref=e2\]\n {2}\+ button "Save" \[disabled\] \[ref=e2\]/)
  }, 15_000)

  it('shows the dialog instead of a diff when one opens', async () => {
    forgetBrowserTab('t1')
    const { host } = fakePage([{ yaml: '- button "Buy" [ref=e2]' }, { yaml: '- dialog "Sign in" [ref=e9]:\n  - button "OK" [ref=e10]', modal: { description: 'dialog "Sign in"', behind: 1 } }])
    const out = textOf(await executeBrowserTool(host, call('browser_click', { target: 'e2' })))
    expect(out).toMatch(/### Dialog opened: dialog "Sign in"\n- dialog "Sign in" \[ref=e9\]:\n {2}- button "OK" \[ref=e10\]/)
    expect(out).toMatch(/Showing only the dialog/)
  }, 15_000)
})

describe('browser_batch', () => {
  it('runs steps in order, one line each, the last in full', async () => {
    forgetBrowserTab('t1')
    const { host } = fakePage([{ yaml: '- button "Go" [ref=e2]' }])
    const r = await executeBrowserTool(host, call('browser_batch', { steps: [{ tool: 'browser_press_key', args: { key: 'Tab' } }, { tool: 'click', args: { target: 'e2' } }] }))
    const out = textOf(r)
    expect(r.isError).toBeUndefined()
    expect(out).toMatch(/### Steps\n1\. press_key: Pressed Tab\n2\. click: Clicked button "Go"/)
    expect(out).toMatch(/### Changes/)
  }, 20_000)

  it('stops at the first failure and refuses excluded tools', async () => {
    forgetBrowserTab('t1')
    const { host } = fakePage([{ yaml: '- button "Go" [ref=e2]' }])
    const out = textOf(await executeBrowserTool(host, call('browser_batch', { steps: [{ tool: 'browser_batch', args: { steps: [] } }, { tool: 'browser_press_key', args: { key: 'Tab' } }] })))
    expect(out).toMatch(/1\. batch: failed: browser_denied: browser_batch cannot run inside a batch\nStopped at step 1/)
    expect(out).not.toMatch(/press_key/)
  })
})

describe('situational hints', () => {
  it('explains [has-submenu] and a CAPTCHA once per page, not on every result', async () => {
    forgetBrowserTab('t1')
    const yaml = '- navigation [ref=e1]:\n  - link "Products" [ref=e3] [has-submenu]'
    const { host } = fakePage([{ yaml, gates: ['captcha'] } as Snap & { gates: string[] }])
    const first = textOf(await executeBrowserTool(host, call('browser_snapshot', {})))
    expect(first).toMatch(/\[has-submenu\] opens on hover/)
    expect(first).toMatch(/CAPTCHA \/ human check[\s\S]*browser_request_help/)
    const second = textOf(await executeBrowserTool(host, call('browser_snapshot', {})))
    expect(second).not.toMatch(/opens on hover|CAPTCHA/)
  })
})

describe('probeHover', () => {
  it('hovers each [has-submenu] trigger and lists what appeared', async () => {
    forgetBrowserTab('t1')
    const base = '- navigation [ref=e1]:\n  - link "Products" [ref=e3] [has-submenu]'
    const { host } = fakePage([{ yaml: base }, { yaml: `${base}\n  - link "Laptops" [ref=e7]` }])
    const out = textOf(await executeBrowserTool(host, call('browser_snapshot', { probeHover: true })))
    expect(out).toMatch(/### Hover menus \(hover the trigger, then click the item\)\n- e3 link "Products":\n {4}\+ link "Laptops" \[ref=e7\]/)
  }, 15_000)
})

describe('snapshot saveTo', () => {
  it('writes the whole unfolded page to a file and returns only its path', async () => {
    forgetBrowserTab('t1')
    const items = Array.from({ length: 30 }, (_, i) => `  - listitem [ref=e${i + 10}]:\n    - link "Product ${i}" [ref=e${i + 100}]`).join('\n')
    const { host } = fakePage([{ yaml: `- list [ref=e1]:\n${items}` }])
    const out = textOf(await executeBrowserTool(host, call('browser_snapshot', { saveTo: 'page.yml' })))
    const m = /### Snapshot saved\n(.+page\.yml) \(\d+ KB, \d+ lines, (\d+) refs\)/.exec(out)
    expect(m, out).toBeTruthy()
    expect(out).not.toMatch(/Product 3/)
    const { readFileSync } = await import('node:fs')
    const saved = readFileSync(m![1], 'utf8')
    expect(saved).toMatch(/link "Product 29"/)
    expect(saved).not.toMatch(/more listitems/)
  })
})

describe('tool coverage', () => {
  it('handles every defined browser tool', async () => {
    const { readFileSync } = await import('node:fs')
    const { BROWSER_TOOL_DEFS } = await import('@shared/browser-tools')
    const source = readFileSync(require('node:path').join(__dirname, 'tools.ts'), 'utf8')
    const missing = BROWSER_TOOL_DEFS.map((d) => d.name).filter((n) => !source.includes(`case '${n}'`) && !source.includes(`call.tool === '${n}'`))
    expect(missing).toEqual([])
  })
})
