import { test, expect } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

/**
 * Downloads go through aria2 (several ranged connections) carrying the page's cookies.
 * Needs an aria2c binary: ARIA2C=/path/to/aria2c, otherwise the test is skipped.
 */
const aria2c = process.env.ARIA2C ?? ''

test.describe('browser downloads', () => {
  test.setTimeout(120_000)

  test('multi-connection download with the page cookies', async () => {
    test.skip(!aria2c || !fs.existsSync(aria2c), 'set ARIA2C to an aria2c binary to run')
    const payload = randomBytes(6 * 1024 * 1024)
    const ranges: string[] = []
    const cookies: string[] = []
    const site = http.createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('set-cookie', 'session=ok; Path=/')
        res.setHeader('content-type', 'text/html')
        res.end('<!doctype html><title>dl</title><a id="dl" href="/file.bin" download="file.bin">get</a>')
        return
      }
      if (req.url === '/file.bin') {
        cookies.push(String(req.headers.cookie ?? ''))
        // Only signed-in requests get the file.
        if (!String(req.headers.cookie ?? '').includes('session=ok')) {
          res.statusCode = 403
          res.end()
          return
        }
        res.setHeader('accept-ranges', 'bytes')
        res.setHeader('content-type', 'application/octet-stream')
        res.setHeader('content-disposition', 'attachment; filename="file.bin"')
        const range = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''))
        if (range) {
          ranges.push(String(req.headers.range))
          const start = Number(range[1])
          const end = range[2] ? Number(range[2]) : payload.length - 1
          res.statusCode = 206
          res.setHeader('content-range', `bytes ${start}-${end}/${payload.length}`)
          res.setHeader('content-length', String(end - start + 1))
          res.end(payload.subarray(start, end + 1))
          return
        }
        res.setHeader('content-length', String(payload.length))
        res.end(payload)
      }
    })
    const base = `http://127.0.0.1:${await listen(site)}`
    const seen: Seen[] = []
    const model = startScriptedModel(() => ({ text: 'ok' }), seen)
    const agent = await launchAgentApp(await listen(model), { config: { browserAria2Path: aria2c, browserDownloadConnections: 8 } })
    const { win, app, home } = agent
    try {
      await win.locator('[data-right-panel-toggle]').click()
      await win.evaluate(() => {
        const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { setState: (s: object) => void } } }).__piE2E
        useUIStore.setState({ activePanel: 'browser', rightPanelWidth: 560 })
      })
      const address = win.getByRole('combobox', { name: /Address bar/ })
      await address.fill(`${base}/`)
      await address.press('Enter')
      await win.waitForTimeout(1200)
      await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        const v = w.contentView.children.find((c) => 'webContents' in c && (c as Electron.WebContentsView).webContents.id !== w.webContents.id) as Electron.WebContentsView
        await v.webContents.executeJavaScript("document.getElementById('dl').click()")
      })
      type Dl = { savePath: string; state: string; via: string; received: number }
      const list = () => win.evaluate(() => (window as unknown as { piDesktop: { invoke: (c: string) => Promise<{ downloads: { savePath: string; state: string; via: string; received: number }[] }> } }).piDesktop.invoke('ipc:browser.downloads.list'))
      await expect.poll(async () => (await list()).downloads[0]?.state, { timeout: 60_000 }).toBe('completed')
      const done = (await list()).downloads[0] as Dl
      expect(done.via).toBe('aria2')
      expect(done.received).toBe(payload.length)
      const file = done.savePath
      expect(path.basename(file)).toBe('file.bin')
      expect(file.startsWith(home)).toBe(true)
      expect(fs.existsSync(`${file}.aria2`)).toBe(false)
      expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(createHash('sha256').update(payload).digest('hex'))
      // Several ranged connections, every one signed in.
      expect(ranges.length).toBeGreaterThan(1)
      expect(cookies.every((c) => c.includes('session=ok'))).toBe(true)
      // The panel lists it as an aria2 download that completed.
      await win.getByRole('button', { name: 'Downloads' }).click()
      await expect(win.getByRole('menu', { name: 'Downloads' })).toContainText('file.bin')
      await expect(win.getByRole('menu', { name: 'Downloads' })).toContainText('Completed')
    } finally {
      await agent.close()
      model.close()
      site.close()
    }
  })

  test('falls back to the built-in downloader when aria2 is unusable', async () => {
    const payload = randomBytes(256 * 1024)
    const site = http.createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('content-type', 'text/html')
        res.end('<!doctype html><a id="dl" href="/small.bin" download="small.bin">get</a>')
        return
      }
      res.setHeader('content-type', 'application/octet-stream')
      res.end(payload)
    })
    const base = `http://127.0.0.1:${await listen(site)}`
    const seen: Seen[] = []
    const model = startScriptedModel(() => ({ text: 'ok' }), seen)
    const agent = await launchAgentApp(await listen(model), { config: { browserAria2Path: '/nonexistent/aria2c' } })
    const { win, app } = agent
    try {
      await win.locator('[data-right-panel-toggle]').click()
      await win.evaluate(() => {
        const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { setState: (s: object) => void } } }).__piE2E
        useUIStore.setState({ activePanel: 'browser', rightPanelWidth: 560 })
      })
      const address = win.getByRole('combobox', { name: /Address bar/ })
      await address.fill(`${base}/`)
      await address.press('Enter')
      await win.waitForTimeout(1200)
      await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        const v = w.contentView.children.find((c) => 'webContents' in c && (c as Electron.WebContentsView).webContents.id !== w.webContents.id) as Electron.WebContentsView
        await v.webContents.executeJavaScript("document.getElementById('dl').click()")
      })
      const list = () => win.evaluate(() => (window as unknown as { piDesktop: { invoke: (c: string) => Promise<{ downloads: { savePath: string; state: string; via: string; received: number }[] }> } }).piDesktop.invoke('ipc:browser.downloads.list'))
      await expect.poll(async () => (await list()).downloads[0]?.state, { timeout: 30_000 }).toBe('completed')
      const done = (await list()).downloads[0]
      expect(done.via).toBe('electron')
      expect(fs.readFileSync(done.savePath).equals(payload)).toBe(true)
    } finally {
      await agent.close()
      model.close()
      site.close()
    }
  })
})
