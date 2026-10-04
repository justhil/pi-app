import { test, expect } from '@playwright/test'
import http from 'node:http'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

test('find in page and page zoom', async () => {
  const site = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><title>find</title><body style="font:16px sans-serif">${Array.from({ length: 30 }, (_, i) => `<p>row ${i} ${i % 10 === 0 ? 'needle' : 'hay'}</p>`).join('')}</body>`)
  })
  const base = `http://127.0.0.1:${await listen(site)}`
  const seen: Seen[] = []
  const model = startScriptedModel(() => ({ text: 'ok' }), seen)
  const agent = await launchAgentApp(await listen(model))
  const { win, app } = agent
  const pageZoom = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const v = w.contentView.children.find((c) => 'webContents' in c && (c as Electron.WebContentsView).webContents.id !== w.webContents.id) as Electron.WebContentsView
      return v.webContents.getZoomFactor()
    })
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

    // Ctrl/⌘+F from the panel chrome opens the find bar; matches are counted.
    await address.focus()
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
    const find = win.getByRole('textbox', { name: 'Find in page' })
    await expect(find).toBeFocused()
    await find.fill('needle')
    await expect(win.getByRole('search')).toContainText('1/3')
    await find.press('Enter')
    await expect(win.getByRole('search')).toContainText('2/3')
    await find.press('Shift+Enter')
    await expect(win.getByRole('search')).toContainText('1/3')
    await find.fill('missing')
    await expect(win.getByRole('search')).toContainText('No results')
    await find.press('Escape')
    await expect(win.getByRole('search')).toHaveCount(0)

    // Zoom steps and reset.
    await address.focus()
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+=' : 'Control+=')
    await expect.poll(pageZoom).toBeCloseTo(1.1, 2)
    await expect(win.getByRole('button', { name: /Reset to 100%/ })).toHaveText('110%')
    await win.getByRole('button', { name: /Reset to 100%/ }).click()
    await expect.poll(pageZoom).toBeCloseTo(1, 2)
  } finally {
    await agent.close()
    model.close()
    site.close()
  }
})
