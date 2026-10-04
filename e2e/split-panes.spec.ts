import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

test.describe('split panes', () => {
  test.setTimeout(200_000)

  test('panes show sessions side by side without stealing focus', async () => {
    const seen: Seen[] = []
    const model = startScriptedModel(
      (_first, _tools, last) => (last.includes('SLOW') ? { text: 'slow work finished', delayMs: 6000 } : { text: `reply to ${last.slice(0, 14)}` }),
      seen,
    )
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    const panes = win.locator('[data-split-pane]')
    const activePane = win.locator('[data-split-pane][data-active]')
    try {
      // Wide enough for two full panes (2 × 320 px + handle) beside the sidebar.
      await agent.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 900))
      await agent.newSession()
      await agent.send('FIRST hello')
      await expect(win.getByText('reply to FIRST hello').first()).toBeVisible({ timeout: 30_000 })
      await agent.newSession()
      await agent.send('SECOND hello')
      await expect(win.getByText('reply to SECOND hello').first()).toBeVisible({ timeout: 30_000 })

      // Ctrl/⌘+click a sidebar session: it opens in a new pane beside the current one.
      const firstRow = win.locator('[data-session-file]').filter({ hasText: 'FIRST hello' }).locator('button').first()
      await firstRow.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
      await expect(panes).toHaveCount(2)
      await expect(activePane).toContainText('FIRST hello')
      await expect(activePane.locator('[data-composer-shell]')).toHaveCount(1)
      const other = win.locator('[data-split-pane]:not([data-active])')
      await expect(other).toContainText('reply to SECOND hello', { timeout: 10_000 })
      await expect(other.locator('[data-composer-shell]')).toHaveCount(0)

      // Start slow work in the active pane, then switch to the other pane while it runs.
      await agent.send('SLOW job please')
      await win.waitForTimeout(800)
      await other.locator('.split-pane-header button').first().click()
      await expect(activePane).toContainText('SECOND hello')
      // The background pane keeps updating; focus stays where the user put it.
      const background = win.locator('[data-split-pane]:not([data-active])')
      await expect(background).toContainText('slow work finished', { timeout: 30_000 })
      await expect(activePane).toContainText('SECOND hello')
      await expect(activePane.locator('[data-composer-shell]')).toHaveCount(1)

      // The global session (what the right panel reads) follows the active pane.
      const focusedTitle = () =>
        win.evaluate(() => {
          const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { getState: () => { historySessionFile: string | null; timelineItems: { type: string; text?: string }[] } } } }).__piE2E
          return useUIStore.getState().timelineItems.find((i) => i.type === 'user-message')?.text ?? ''
        })
      await expect.poll(focusedTitle).toContain('SECOND hello')

      // Keyboard: Ctrl/⌘+Alt+→ moves to the next pane.
      await win.locator('body').click({ position: { x: 5, y: 400 } })
      await win.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Alt+ArrowRight`)
      await expect.poll(focusedTitle).toContain('FIRST hello')

      // Closing a pane keeps its session.
      const header = win.locator('[data-split-pane]').nth(1).locator('.split-pane-header')
      await header.hover()
      await header.getByRole('button', { name: 'Close pane' }).click()
      await expect(panes).toHaveCount(0)
      // The closed pane showed FIRST; its session is still listed.
      await expect(win.locator('[data-session-file]').filter({ hasText: 'FIRST hello' })).toHaveCount(1)

      // Drag a sidebar session onto the right side of the conversation: a new pane opens there.
      const row = win.locator('[data-session-file]').filter({ hasText: 'FIRST hello' })
      const center = win.locator('.main-chat-column').first()
      const box = (await center.boundingBox())!
      await row.dragTo(center, { targetPosition: { x: box.width - 40, y: box.height / 2 } })
      await expect(panes).toHaveCount(2)
      await expect(win.locator('[data-split-pane]').nth(1)).toContainText('FIRST hello')

      // Panes always fill the split area (no unused space), also with a collapsed strip.
      const fill = () =>
        win.evaluate(() => {
          const root = (document.querySelector('.split-view') as HTMLElement).getBoundingClientRect()
          const panes = [...document.querySelectorAll('[data-split-pane]')].map((p) => p.getBoundingClientRect())
          return Math.abs(root.right - panes[panes.length - 1].right) + Math.abs(panes[0].left - root.left)
        })
      expect(await fill()).toBeLessThan(2)
      await agent.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 760))
      // The shell animates its columns; wait for the layout to settle.
      await expect.poll(fill, { timeout: 5000 }).toBeLessThan(2)
    } finally {
      await agent.close()
      model.close()
    }
  })
})
