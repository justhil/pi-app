import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

// Default settings: no popup for background conversations, but the inbox still lists what finished.
test('a conversation finishing in the background lands in the inbox and is read once opened', async () => {
  const model = startScriptedModel((_first, _tools, last) =>
    last.includes('slow job') ? { delayMs: 5000, text: 'slow job finished' } : { text: `ok ${last}` }, [])
  const agent = await launchAgentApp(await listen(model))
  const { win } = agent
  const row = (text: string) => win.locator('.sidebar-session-row').filter({ hasText: text }).first()
  const inboxButton = win.getByRole('button', { name: 'Notifications' }).first()
  try {
    await agent.newSession()
    await agent.send('other chat')
    await expect(win.getByText('ok other chat').first()).toBeVisible({ timeout: 30_000 })
    await agent.newSession()
    await agent.send('slow job')
    await win.waitForTimeout(1000)
    await row('other chat').click()
    await expect(win.getByText('ok other chat').first()).toBeVisible()

    // The background run settles (5s) and the controller files it after its 2s grace delay.
    await win.waitForTimeout(9000)
    await inboxButton.click()
    const history = win.getByRole('region', { name: 'Recently completed' })
    const entry = history.locator('.notification-row').first()
    await expect(entry).toBeVisible({ timeout: 10_000 })
    await expect(entry).toHaveAttribute('data-unread', 'true')
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })

    await entry.locator('.workbench-list-row').click()
    await expect(win.getByText('slow job finished').first()).toBeVisible({ timeout: 15_000 })
    await win.keyboard.press('Escape')
    await inboxButton.click()
    await expect(history.locator('.notification-row').first()).not.toHaveAttribute('data-unread', 'true')
  } finally {
    await agent.close()
    model.close()
  }
})

// App minimized while the visible conversation finishes: the popup card appears, and Open
// brings the window back on that conversation with its inbox row read.
test('a minimized app shows the popup card, and Open returns to the conversation', async () => {
  const model = startScriptedModel((_first, _tools, last) =>
    last.includes('slow job') ? { delayMs: 4000, text: 'slow job finished' } : { text: `ok ${last}` }, [])
  const agent = await launchAgentApp(await listen(model))
  const { app, win } = agent
  try {
    await agent.newSession()
    await agent.send('slow job')
    await win.waitForTimeout(500)
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.minimize() })

    const popup = await app.waitForEvent('window', { timeout: 20_000 })
    await expect(popup.locator('.card').first()).toContainText('slow job', { timeout: 10_000 })
    if (process.env.SHOT) await popup.screenshot({ path: process.env.SHOT.replace('.png', '-popup.png') })
    await popup.locator('.card .open').first().click()

    await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => !w.isMinimized() && w.isVisible() && w.webContents.getURL().includes('index.html'))), { timeout: 10_000 }).toBe(true)
    await expect(win.getByText('slow job finished').first()).toBeVisible({ timeout: 10_000 })
    await win.getByRole('button', { name: 'Notifications' }).first().click()
    const entry = win.getByRole('region', { name: 'Recently completed' }).locator('.notification-row').first()
    await expect(entry).toBeVisible()
    await expect(entry).not.toHaveAttribute('data-unread', 'true')
  } finally {
    await agent.close()
    model.close()
  }
})

