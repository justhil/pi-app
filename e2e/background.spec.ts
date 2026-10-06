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
      await win.getByRole('button', { name: 'Save', exact: true }).click()
      await shot(win, 'settings')
      await win.getByRole('button', { name: 'Back', exact: true }).click()
      expect(await win.locator('.main-chat-column').first().evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur')
      await shot(win, 'chat')
      await agent.app.close()

      // The launcher rewrites pi-desktop.json: carry the saved background over, as a restart would keep it.
      const saved = JSON.parse(fs.readFileSync(path.join(agent.home, '.config', 'Electron', 'pi-desktop.json'), 'utf8'))
      expect(saved.background.light).toMatchObject({ uiOpacity: 0.7, fit: 'cover' })
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
