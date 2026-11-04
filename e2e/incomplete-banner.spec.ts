import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

// The reported case: a reply whose request timed out through every retry. Read back from history
// (after a switch or restart) it must say why it failed, not just "incomplete reply".
test('a reply that failed after retries keeps its reason when read back from history', async () => {
  const model = startScriptedModel((_first, _tools, last) =>
    last.includes('fail me') ? { errorStatus: 503, text: 'Request timed out.' } : { text: `ok ${last}` }, [])
  const agent = await launchAgentApp(await listen(model))
  const { win } = agent
  const row = (text: string) => win.locator('.sidebar-session-row').filter({ hasText: text }).first()
  try {
    await agent.newSession()
    await agent.send('other chat')
    await expect(win.getByText('ok other chat').first()).toBeVisible({ timeout: 30_000 })
    await agent.newSession()
    await agent.send('fail me')
    await expect(win.getByText(/Retry failed/).first()).toBeVisible({ timeout: 90_000 })
    await expect(win.getByRole('button', { name: /^Stop/ })).toHaveCount(0, { timeout: 30_000 })

    await row('other chat').click()
    await expect(win.getByText('ok other chat').first()).toBeVisible()
    await win.getByRole('button', { name: /Reload session and project lists/ }).click()
    await row('fail me').click()

    await expect(win.getByText(/Reply failed: .*Request timed out/).first()).toBeVisible({ timeout: 15_000 })
    await expect(win.getByText(/Incomplete reply/)).toHaveCount(0)
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
  } finally {
    await agent.close()
    model.close()
  }
})
