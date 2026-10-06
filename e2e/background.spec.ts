import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

const FIXTURE = path.resolve('e2e/fixtures/background.jpg')
const attr = (win: Page) => win.evaluate(() => document.documentElement.getAttribute('data-bg'))

test.describe('background image', () => {
  test.setTimeout(120_000)

  test('picks an image, shows it behind frosted panes, survives a restart, and removes it', async () => {
    const model = startScriptedModel(() => ({ text: 'The background sits behind the panes; this reply stays on a frosted surface.' }), [])
    const port = await listen(model)
    const agent = await launchAgentApp(port, { config: { theme: 'light' }, keepHome: true })
    const { win, app } = agent
    const shot = (w: Page, name: string) => (process.env.SHOT ? w.screenshot({ path: process.env.SHOT.replace('.png', `-${name}.png`) }) : Promise.resolve())
    let second: Awaited<ReturnType<typeof launchAgentApp>> | null = null
    try {
      await agent.newSession()
      await agent.send('Hello')
      await expect(win.locator('.prose-chat').last()).toContainText('frosted surface', { timeout: 30_000 })
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
      }, FIXTURE)

      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Appearance', { exact: true }).first().click()
      await win.getByRole('button', { name: 'Choose image…' }).click()
      await expect.poll(() => attr(win)).toBe('on')
      await expect(win.locator('#pi-background')).toHaveClass(/is-loaded/)
      await win.getByRole('slider', { name: 'Interface opacity' }).fill('0.7')
      // Whole-interface cover, liquid glass, and the chat / right panel tuned on their own.
      const rootAttr = (name: string) => win.evaluate((n) => document.documentElement.getAttribute(n), name)
      const rootVar = (name: string) => win.evaluate((n) => document.documentElement.style.getPropertyValue(n), name)
      expect(await rootAttr('data-bg-cover')).toBe('frame')
      await win.getByRole('switch', { name: 'Show through the whole interface' }).click()
      await win.getByRole('combobox', { name: 'Pane material' }).selectOption('glass')
      expect(await rootAttr('data-bg-cover')).toBe('full')
      expect(await rootAttr('data-bg-content-material')).toBe('glass')
      await win.getByRole('switch', { name: 'Tune chat and right panel separately' }).click()
      await win.getByRole('slider', { name: 'Chat & right panel opacity' }).fill('0.5')
      await win.getByRole('combobox', { name: 'Chat & right panel material' }).selectOption('clear')
      expect(await rootVar('--content-alpha')).toBe('0.5')
      expect(await rootVar('--ui-alpha')).toBe('0.7')
      expect(await rootAttr('data-bg-material')).toBe('glass')
      expect(await rootAttr('data-bg-content-material')).toBe('clear')
      await win.getByRole('switch', { name: 'Vignette' }).click()
      await expect(win.locator('#pi-background')).toHaveClass(/has-vignette/)
      await win.getByRole('button', { name: 'Save', exact: true }).click()
      await shot(win, 'settings')
      await win.getByRole('button', { name: 'Back', exact: true }).click()
      // Clear material: tint only, no blur behind the chat column.
      expect(await win.locator('.main-chat-column').first().evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none')
      expect(await win.locator('.shell-track-left').first().evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('saturate(1.8)')
      await shot(win, 'chat')
      await agent.app.close()

      // The launcher rewrites pi-desktop.json: carry the saved background over, as a restart would keep it.
      const saved = JSON.parse(fs.readFileSync(path.join(agent.home, '.config', 'Electron', 'pi-desktop.json'), 'utf8'))
      expect(saved.background.light).toMatchObject({ uiOpacity: 0.7, fit: 'cover', fullCover: true, material: 'glass', vignette: true, content: { uiOpacity: 0.5, material: 'clear' } })
      second = await launchAgentApp(port, { home: agent.home, config: { theme: 'light', background: saved.background } })
      await expect.poll(() => attr(second!.win), { timeout: 15_000 }).toBe('on')
      await second.win.locator('button:has-text("Settings")').first().click()
      await second.win.getByText('Appearance', { exact: true }).first().click()
      await second.win.getByRole('button', { name: /^Remove/ }).click()
      await expect.poll(() => attr(second!.win)).toBeNull()
      await expect(second.win.locator('#pi-background')).toHaveCount(0)
    } finally {
      await (second ?? agent).close().catch(() => {})
      model.close()
    }
  })
})
