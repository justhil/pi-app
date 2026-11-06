import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test('sidebar fork submenu forks from a message and lists the fork flat with its source', async () => {
  const model = startScriptedModel((_first, _tools, last) => ({ text: `Reply to ${last}` }), [])
  const agent = await launchAgentApp(await listen(model))
  const { win } = agent
  try {
    await agent.newSession()
    await agent.send('first question')
    await expect(win.getByText('Reply to first question').first()).toBeVisible({ timeout: 30_000 })
    await agent.send('second question')
    await expect(win.getByText('Reply to second question').first()).toBeVisible({ timeout: 30_000 })

    const row = win.locator('.sidebar-session-row').filter({ hasText: 'first question' }).first()
    await row.click({ button: 'right' })
    await win.getByRole('button', { name: 'Fork', exact: true }).hover()
    const submenu = win.locator('[data-session-fork-submenu]')
    await expect(submenu.getByRole('menuitem', { name: 'second question' })).toBeVisible({ timeout: 15_000 })
    await expect(submenu.getByRole('menuitem', { name: 'Duplicate whole conversation' })).toBeVisible()
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-submenu.png') })

    await submenu.getByRole('menuitem', { name: 'second question' }).click()
    await expect(win.getByText(/^Forked from: /)).toBeVisible({ timeout: 20_000 })
    await expect(win.locator('[contenteditable="true"]').last()).toContainText('second question')
    // Forks are top-level rows, not nested under the source like subagents.
    await expect(win.locator('.sidebar-children-guide .sidebar-session-row')).toHaveCount(0)
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-sidebar.png') })

    // The source's submenu now offers the fork as an existing branch.
    const source = win.locator('.sidebar-session-row').filter({ hasNotText: 'Forked from' }).filter({ hasText: 'first question' }).first()
    await source.click({ button: 'right' })
    await win.getByRole('button', { name: 'Fork', exact: true }).hover()
    await expect(submenu.getByText('Existing forks')).toBeVisible()
  } finally {
    await agent.close()
    model.close()
  }
})
