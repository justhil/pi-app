import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test.describe('built-in terminal', () => {
  test.setTimeout(120_000)

  test('Ctrl+` opens a shell in the project, runs a command, splits, closes one pane, closes the tab', async () => {
    const model = startScriptedModel(() => ({ text: 'ok' }), [])
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    const rows = win.locator('.terminal-drawer .xterm-rows')
    try {
      await agent.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 720))
      await agent.newSession()
      await win.locator('body').click({ position: { x: 5, y: 300 } })
      await win.keyboard.press('Control+Backquote')
      await expect(win.locator('.terminal-drawer [role="tab"]')).toHaveCount(1, { timeout: 15_000 })
      await expect(rows.first()).toBeVisible()
      await win.locator('.terminal-drawer .xterm').first().click()
      await win.keyboard.type('echo PI_TERM_$((40+2)); pwd\n')
      await expect(rows.first()).toContainText('PI_TERM_42', { timeout: 15_000 })
      await expect(rows.first()).toContainText('demo')
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-terminal.png') })

      // Hide keeps the shell; showing again shows the same output.
      await win.keyboard.press('Control+Backquote')
      await expect(win.locator('.shell-track-bottom')).toHaveClass(/invisible/)
      await win.keyboard.press('Control+Backquote')
      await expect(rows.first()).toContainText('PI_TERM_42')

      // Split: a second shell beside the first.
      await win.getByRole('button', { name: 'Split right' }).click()
      await win.getByRole('menuitem').first().click()
      await expect(rows).toHaveCount(2, { timeout: 15_000 })
      // A third, then close the middle one on its own: the other two stay.
      await win.getByRole('button', { name: 'Split right' }).click()
      await win.getByRole('menuitem').first().click()
      await expect(rows).toHaveCount(3, { timeout: 15_000 })
      await expect(win.locator('.terminal-drawer [role="separator"][aria-orientation="vertical"]')).toHaveCount(2)
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-split.png') })
      const closePane = win.locator('.terminal-drawer').getByRole('button', { name: 'Close pane' })
      await expect(closePane).toHaveCount(3)
      await closePane.nth(1).click({ force: true })
      await expect(rows).toHaveCount(2)
      // Ctrl+Shift+W closes the focused pane; one pane left drops the pane headers.
      await win.locator('.terminal-drawer .xterm').first().click()
      await win.keyboard.press('Control+Shift+W')
      await expect(rows).toHaveCount(1)
      await expect(closePane).toHaveCount(0)
      await win.getByRole('button', { name: 'Split right' }).click()
      await win.getByRole('menuitem').first().click()
      await expect(rows).toHaveCount(2, { timeout: 15_000 })

      // Closing the tab ends both shells and hides the drawer.
      const tab = win.locator('.terminal-drawer [role="tab"]').first()
      await tab.hover()
      await tab.getByRole('button', { name: 'Close terminal' }).click()
      await expect(win.locator('.terminal-drawer [role="tab"]')).toHaveCount(0)
      await expect(win.locator('.shell-track-bottom')).toHaveClass(/invisible/)
    } finally {
      // Running terminals make the close guard ask first; end them so the app can quit.
      await win.evaluate(() => document.querySelectorAll<HTMLButtonElement>('.terminal-drawer [aria-label="Close terminal"]').forEach((b) => b.click())).catch(() => {})
      await agent.close()
      model.close()
    }
  })
})
