import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

// A running conversation keeps updating after the user looks at another one and comes back.
test('a running session shows its new tool calls and reply after switching away and back', async () => {
  const model = startScriptedModel((_first, tools, last) => {
    if (!last.includes('go long')) return { text: `ok ${last}` }
    if (tools.length === 0) return { delayMs: 4000, tool: { name: 'read', args: { path: 'README.md' } } }
    return { delayMs: 4000, text: 'final answer after the tool' }
  }, [])
  const agent = await launchAgentApp(await listen(model))
  const { win } = agent
  const row = (text: string) => win.locator('.sidebar-session-row').filter({ hasText: text }).first()
  try {
    await agent.newSession()
    await agent.send('first A')
    await expect(win.getByText('ok first A').first()).toBeVisible({ timeout: 30_000 })
    await agent.newSession()
    await agent.send('first B')
    await expect(win.getByText('ok first B').first()).toBeVisible({ timeout: 30_000 })

    await row('first A').click()
    await expect(win.getByText('ok first A').first()).toBeVisible()
    await agent.send('go long')
    await win.waitForTimeout(1000)
    await row('first B').click()
    await expect(win.getByText('ok first B').first()).toBeVisible()
    await win.waitForTimeout(5000)
    await row('first A').click()

    await expect(win.getByText('final answer after the tool').first()).toBeVisible({ timeout: 30_000 })
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
  } finally {
    await agent.close()
    model.close()
  }
})

// The reported case: the previous turn ended in "retry failed", then "continue" runs while the
// user looks at another conversation.
test('after a failed retry, the continued turn keeps updating across a switch', async () => {
  const model = startScriptedModel((_first, tools, last) => {
    if (last.includes('fail me')) return { errorStatus: 503, text: 'Request timed out.' }
    if (!last.includes('continue')) return { text: `ok ${last}` }
    if (tools.length === 0) return { delayMs: 10000, tool: { name: 'read', args: { path: 'README.md' } } }
    return { delayMs: 4000, text: 'final answer after the retry' }
  }, [])
  const agent = await launchAgentApp(await listen(model))
  const { win } = agent
  const row = (text: string) => win.locator('.sidebar-session-row').filter({ hasText: text }).first()
  try {
    await agent.newSession()
    await agent.send('first B')
    await expect(win.getByText('ok first B').first()).toBeVisible({ timeout: 30_000 })
    await agent.newSession()
    await agent.send('fail me')
    await expect(win.getByText(/Request timed out/).first()).toBeVisible({ timeout: 90_000 })
    await expect(win.getByRole('button', { name: /^Stop/ })).toHaveCount(0, { timeout: 30_000 })

    await agent.send('continue')
    await win.waitForTimeout(1000)
    await row('first B').click()
    await expect(win.getByText('ok first B').first()).toBeVisible()
    await win.waitForTimeout(3000)
    await row('fail me').click()
    // Still waiting on the model: the wait slot must come back with the view, not blank space.
    await expect(win.getByText(/Waiting for the model/).first()).toBeVisible({ timeout: 3000 })

    await expect(win.getByText('final answer after the retry').first()).toBeVisible({ timeout: 30_000 })
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-retry.png') })
  } finally {
    await agent.close()
    model.close()
  }
})
