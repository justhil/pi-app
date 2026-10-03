import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { root } from './helpers/scripted-agent'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const mainEntry = path.join(root, 'out/main/index.js')

/**
 * Annotation mode scrolling: same long page, same wheel gesture (15 × 100px at 16 ms), measured
 * in the renderer. Reproduce with: npx playwright test e2e/browser-annotate-scroll.spec.ts
 */
async function pageScrollY(app: ElectronApplication): Promise<number> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const v = win.contentView.children.find((c) => 'webContents' in c && (c as Electron.WebContentsView).webContents.id !== win.webContents.id) as Electron.WebContentsView
    return v.webContents.executeJavaScript('scrollY')
  })
}

test('annotation mode scrolls without stalling', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => `<p style="height:40px;margin:0;border-bottom:1px solid #ddd">Row ${i}</p>`).join('')
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><title>Long</title><body style="margin:0;font:16px sans-serif">${rows}</body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-annot-'))
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry, '--ozone-platform=x11', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    env: { ...process.env, PI_E2E: '1', XDG_CONFIG_HOME: configHome, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 60_000,
  })
  try {
    const win = await app.firstWindow({ timeout: 45_000 })
    await win.waitForFunction(() => !!(window as unknown as { __piE2E?: unknown }).__piE2E, null, { timeout: 45_000 })
    await expect
      .poll(async () => {
        await win.evaluate(() => {
          const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { getState: () => Record<string, unknown>; setState: (s: object) => void } } }).__piE2E
          useUIStore.setState({ rightPanelPrefs: { ...(useUIStore.getState().rightPanelPrefs as object), browser: true }, activePanel: 'browser', rightPanelCollapsed: false, rightPanelExpandedOnNarrow: true, rightPanelWidth: 560 })
        })
        await win.waitForTimeout(300)
        return win.getByRole('textbox', { name: /Address bar|地址栏/ }).count()
      }, { timeout: 30_000 })
      .toBe(1)
    const address = win.getByRole('textbox', { name: /Address bar|地址栏/ })
    await address.fill(`${base}/`)
    await address.press('Enter')
    await win.waitForTimeout(1500)
    await win.getByRole('button', { name: /Annotate|批注/ }).first().click()
    const layer = win.locator('[data-annotation-layer]')
    await expect(layer).toBeVisible()
    await win.waitForTimeout(500)
    const box = (await layer.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    // Watch the frozen page image: first visual change after the first wheel, and swaps.
    await win.evaluate(() => {
      const w = window as unknown as { __m: { t0: number; first: number; swaps: number; longTasks: number; maxGap: number; last: number } }
      w.__m = { t0: 0, first: 0, swaps: 0, longTasks: 0, maxGap: 0, last: performance.now() }
      const img = document.querySelector('[data-annotation-layer] img') as HTMLImageElement
      const mark = () => {
        if (w.__m.t0 && !w.__m.first) w.__m.first = performance.now() - w.__m.t0
      }
      new MutationObserver((list) => {
        for (const m of list) {
          if (m.attributeName === 'src') w.__m.swaps++
          mark()
        }
      }).observe(img, { attributes: true, attributeFilter: ['src', 'style'] })
      new PerformanceObserver((l) => (w.__m.longTasks += l.getEntries().length)).observe({ type: 'longtask', buffered: false })
      const frame = () => {
        const now = performance.now()
        w.__m.maxGap = Math.max(w.__m.maxGap, now - w.__m.last)
        w.__m.last = now
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
      document.querySelector('[data-annotation-layer]')!.addEventListener('wheel', () => { if (!w.__m.t0) w.__m.t0 = performance.now() }, { capture: true })
    })
    for (let i = 0; i < 15; i++) {
      await win.mouse.wheel(0, 100)
      await win.waitForTimeout(16)
    }
    await expect.poll(() => pageScrollY(app), { timeout: 5000 }).toBe(1500)
    await win.waitForTimeout(800)
    const m = await win.evaluate(() => (window as unknown as { __m: object }).__m)
    console.log('[annotate-scroll]', JSON.stringify(m))
    const metrics = m as { first: number; swaps: number; maxGap: number }
    // Visual feedback within ~2 frames, and only a couple of re-captures for one gesture.
    expect(metrics.first).toBeGreaterThan(0)
    expect(metrics.first).toBeLessThan(50)
    expect(metrics.swaps).toBeLessThanOrEqual(3)

    // Leave annotation mode; open a second tab, then close tabs with the middle button.
    await win.keyboard.press('Escape')
    await win.getByRole('button', { name: /Exit|退出/ }).first().click().catch(() => {})
    await win.getByRole('button', { name: /New tab|新标签/ }).first().click()
    const tabs = win.locator('[data-browser-tab]')
    await expect(tabs).toHaveCount(2)
    await tabs.nth(1).click({ button: 'middle' })
    await expect(tabs).toHaveCount(0) // one tab left: the strip hides
    await expect(win.getByRole('textbox', { name: /Address bar|地址栏/ })).toHaveValue(/127\.0\.0\.1/)

    // Right panel tab strip: vertical wheel over it scrolls it sideways, not the page.
    await win.evaluate(() => {
      const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { setState: (s: object) => void } } }).__piE2E
      useUIStore.setState({ rightPanelWidth: 300 })
    })
    const strip = win.locator('.right-panel-tabs-scroll')
    const overflow = await strip.evaluate((el) => el.scrollWidth - el.clientWidth)
    if (overflow > 0) {
      await strip.hover()
      await win.mouse.wheel(0, 200)
      await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    }
  } finally {
    await app.close()
    server.close()
    fs.rmSync(configHome, { recursive: true, force: true })
  }
})
