import { test, expect, type Page } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

const REPLY = '## Plan\n\nThe parser keeps **one pass** over the input and reports the first error with its line.\n\n```ts\nexport function parse(src: string) {\n  return src.split("\\n").map((line, i) => ({ i, line }))\n}\n```\n\nThen the tests cover empty input and a trailing newline.'

const rootVar = (win: Page, name: string) => win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

test.describe('themes', () => {
  test.setTimeout(120_000)

  test('the Claude preset restyles the chat in light and dark', async () => {
    const model = startScriptedModel(() => ({ text: REPLY }), [])
    const agent = await launchAgentApp(await listen(model), { config: { theme: 'light' } })
    const { win } = agent
    const shot = (name: string) => (process.env.SHOT ? win.screenshot({ path: process.env.SHOT.replace('.png', `-${name}.png`) }) : Promise.resolve())
    try {
      await agent.newSession()
      await agent.send('Sketch the parser')
      await expect(win.locator('.prose-chat h2')).toHaveText('Plan', { timeout: 30_000 })

      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Appearance', { exact: true }).first().click()
      const light = win.getByRole('heading', { name: 'Light theme' }).locator('xpath=ancestor::section[1]')
      await light.getByRole('radio', { name: 'Claude' }).click()
      await expect.poll(() => rootVar(win, '--chat-bg')).toBe('#faf9f5')
      expect(await rootVar(win, '--font-display')).toMatch(/serif$/)
      await shot('settings')

      const dark = win.getByRole('heading', { name: 'Dark theme' }).locator('xpath=ancestor::section[1]')
      await dark.getByRole('radio', { name: 'Claude' }).click()
      await win.getByRole('button', { name: 'Save', exact: true }).click()
      await win.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(win.locator('.prose-chat h2')).toBeVisible()
      // Headings use the serif stack; replies use the display font.
      expect(await win.locator('.prose-chat h2').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/serif/i)
      await shot('light')

      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Appearance', { exact: true }).first().click()
      await win.getByRole('button', { name: 'Dark', exact: true }).click()
      await win.getByRole('button', { name: 'Save', exact: true }).click()
      await win.getByRole('button', { name: 'Back', exact: true }).click()
      await expect.poll(() => rootVar(win, '--chat-bg')).toBe('#262624')
      await shot('dark')
    } finally {
      await agent.close()
      model.close()
    }
  })
})
