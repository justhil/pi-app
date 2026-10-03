import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out/main/index.js')
const shotDir = path.join(root, 'test-results', 'browser')

type Seen = { path: string; secChUa?: string; acceptLanguage?: string }

function startServer(seen: Seen[]): Promise<http.Server> {
  const page = (title: string, body: string) => `<!doctype html><title>${title}</title><body style="font:16px sans-serif;margin:24px">${body}</body>`
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? '', secChUa: req.headers['sec-ch-ua'] as string, acceptLanguage: req.headers['accept-language'] as string })
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/b') res.end(page('Page B', '<h1>Page B</h1>'))
    else res.end(page('Page A', '<h1 style="color:#2563eb">Page A</h1><a href="/b">to B</a>'))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** Main-side view state: only WebContentsViews other than the app renderer are browser tabs. */
async function viewState(app: ElectronApplication) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.contentView.children.length > 1) ?? BrowserWindow.getAllWindows()[0]
    const views = win.contentView.children.filter((v) => 'webContents' in v && (v as { webContents: Electron.WebContents }).webContents.id !== win.webContents.id) as Electron.WebContentsView[]
    return Promise.all(
      views.map(async (v) => ({
        url: v.webContents.getURL(),
        bounds: v.getBounds(),
        visible: v.getVisible(),
        page: v.webContents.getURL().startsWith('http')
          ? await v.webContents.executeJavaScript('({ua:navigator.userAgent,langs:navigator.languages,req:typeof require})')
          : null,
      })),
    )
  })
}

async function placeholderRect(window: Page) {
  return window.locator('[data-browser-viewport]').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
}

test.describe('built-in browser panel', () => {
  test('browses, tracks layout and hides under overlays', async () => {
    const seen: Seen[] = []
    const server = await startServer(seen)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-browser-'))
    fs.mkdirSync(shotDir, { recursive: true })
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry, '--ozone-platform=x11', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
      env: { ...process.env, PI_E2E: '1', XDG_CONFIG_HOME: configHome, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.unmaximize()
        win.setContentSize(1500, 950)
      })
      await window.waitForFunction(() => !!(window as unknown as { __piE2E?: unknown }).__piE2E, null, { timeout: 45_000 })
      const enablePanel = () =>
        window.evaluate(() => {
          const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { getState: () => Record<string, unknown>; setState: (s: object) => void } } }).__piE2E
          const prefs = { ...(useUIStore.getState().rightPanelPrefs as object), browser: true }
          useUIStore.setState({ rightPanelPrefs: prefs, activePanel: 'browser', rightPanelCollapsed: false, rightPanelExpandedOnNarrow: true, rightPanelWidth: 560 })
        })
      // The persisted panel prefs load asynchronously after start-up; re-apply until the panel sticks.
      await expect
        .poll(async () => {
          await enablePanel()
          await window.waitForTimeout(300)
          return window.getByRole('textbox', { name: /Address bar|地址栏/ }).count()
        }, { timeout: 30_000 })
        .toBe(1)
      const address = window.getByRole('textbox', { name: /Address bar|地址栏/ })
      await expect(address).toBeVisible()
      expect(await viewState(app)).toEqual([]) // nothing created until the user navigates

      await address.fill(`127.0.0.1:${(server.address() as AddressInfo).port}/a`)
      await address.press('Enter')
      await expect.poll(async () => (await viewState(app))[0]?.url).toBe(`${base}/a`)
      await expect.poll(async () => (await viewState(app))[0]?.visible).toBe(true)

      const [tab] = await viewState(app)
      const rect = await placeholderRect(window)
      expect(Math.abs(tab.bounds.x - rect.x)).toBeLessThanOrEqual(2)
      expect(Math.abs(tab.bounds.y - rect.y)).toBeLessThanOrEqual(2)
      expect(Math.abs(tab.bounds.width - rect.width)).toBeLessThanOrEqual(2)
      expect(tab.page.ua).not.toMatch(/Electron|pi-desktop|pi Desktop/i)
      // navigator.languages repeats the base language in Electron (known, not patched); headers are Chrome-shaped.
      expect(seen.find((s) => s.path === '/a')?.acceptLanguage ?? '').not.toMatch(/(^|,)([a-z]+)(;[^,]*)?,\2(;|,|$)/)
      expect(tab.page.req).toBe('undefined')
      // Client hints are only sent to https origins; opt-in network check (PI_E2E_NETWORK=1).
      if (process.env.PI_E2E_NETWORK === '1') {
        await address.fill('https://httpbin.org/headers')
        await address.press('Enter')
        await expect.poll(async () => (await viewState(app))[0]?.url, { timeout: 30_000 }).toBe('https://httpbin.org/headers')
        const echoed = await app.evaluate(async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0]
          const v = win.contentView.children.find((c) => 'webContents' in c && (c as Electron.WebContentsView).webContents.id !== win.webContents.id) as Electron.WebContentsView
          for (let i = 0; i < 50 && v.webContents.isLoading(); i++) await new Promise((r) => setTimeout(r, 200))
          return v.webContents.executeJavaScript('document.body.innerText')
        })
        expect(echoed).toContain('Google Chrome')
        await address.fill(`${base}/a`)
        await address.press('Enter')
        await expect.poll(async () => (await viewState(app))[0]?.url).toBe(`${base}/a`)
      }
      await window.screenshot({ path: path.join(shotDir, 'panel-renderer.png') })
      const pagePng = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const v = win.contentView.children.find((c) => 'webContents' in c && (c as Electron.WebContentsView).webContents.id !== win.webContents.id) as Electron.WebContentsView
        return (await v.webContents.capturePage()).toPNG().toString('base64')
      })
      fs.writeFileSync(path.join(shotDir, 'panel-page.png'), Buffer.from(pagePng, 'base64'))

      // UI scale (CSS zoom on <html>): the view must still sit exactly over the placeholder.
      for (const zoom of ['1', '1.1', '0.9']) {
        await window.evaluate((z) => {
          document.documentElement.style.zoom = z
          window.dispatchEvent(new Event('resize'))
        }, zoom)
        await window.waitForTimeout(300)
        const b = (await viewState(app))[0].bounds
        const hits = await window.evaluate(({ x, y, w, h }) => {
          const inside = (px: number, py: number) => !!document.elementFromPoint(px, py)?.closest('[data-browser-viewport]')
          // 8px inset: the panel resize handle overlaps the panel's left edge by a few px.
          return [inside(x + 8, y + 8), inside(x + w - 8, y + h - 8), !inside(x - 8, y + 8) || !inside(x + 8, y - 8)]
        }, { x: b.x, y: b.y, w: b.width, h: b.height })
        expect(hits, `zoom ${zoom}`).toEqual([true, true, true])
      }
      await window.evaluate(() => {
        document.documentElement.style.zoom = '1'
        window.dispatchEvent(new Event('resize'))
      })

      // Navigate, then go back with the toolbar button.
      await address.fill(`${base}/b`)
      await address.press('Enter')
      await expect.poll(async () => (await viewState(app))[0]?.url).toBe(`${base}/b`)
      await window.getByRole('button', { name: /^(Back|后退)$/ }).click()
      await expect.poll(async () => (await viewState(app))[0]?.url).toBe(`${base}/a`)

      // Expand into the chat column: the view grows with its placeholder.
      const before = (await viewState(app))[0].bounds.width
      await window.getByRole('button', { name: /Expand into chat area|展开到聊天区/ }).click()
      await expect.poll(async () => (await viewState(app))[0].bounds.width).toBeGreaterThan(before + 100)
      await window.keyboard.press('Escape')
      await expect.poll(async () => (await viewState(app))[0].bounds.width).toBeLessThan(before + 5)

      // A dialog over the panel hides the native view; closing it shows the view again.
      await window.evaluate(() => {
        const d = document.createElement('div')
        d.id = 'e2e-overlay'
        d.setAttribute('role', 'dialog')
        d.style.cssText = 'position:fixed;inset:0;z-index:9999'
        document.body.appendChild(d)
      })
      await expect.poll(async () => (await viewState(app))[0].visible).toBe(false)
      await window.evaluate(() => document.getElementById('e2e-overlay')?.remove())
      await expect.poll(async () => (await viewState(app))[0].visible).toBe(true)

      // Collapsing the right panel unmounts the panel and hides the view.
      await window.evaluate(() => {
        ;(window as unknown as { __piE2E: { useUIStore: { setState: (s: object) => void } } }).__piE2E.useUIStore.setState({ rightPanelCollapsed: true })
      })
      await expect.poll(async () => (await viewState(app))[0].visible).toBe(false)

      // Disabling the panel releases all tabs in Main.
      await window.evaluate(() => {
        const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { getState: () => Record<string, unknown>; setState: (s: object) => void } } }).__piE2E
        useUIStore.setState({ rightPanelCollapsed: false, rightPanelPrefs: { ...(useUIStore.getState().rightPanelPrefs as object), browser: false } })
      })
      await expect.poll(async () => (await viewState(app)).length).toBe(0)
    } finally {
      await app.close()
      server.close()
      fs.rmSync(configHome, { recursive: true, force: true })
    }
  })
})
