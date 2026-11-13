import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test.describe('session switch & fast abort/rewind isolation', () => {
  test('fast stop and immediate re-send runs as fresh turn without duplication', async () => {
    const seenPrompts: string[] = []
    const model = startScriptedModel((_first, _tools, last) => {
      seenPrompts.push(last)
      if (last.includes('slow first')) {
        return { delayMs: 8000, text: 'slow reply that should be aborted' }
      }
      return { text: `fresh-ok: ${last}` }
    }, [])

    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      await agent.newSession()
      await agent.send('slow first')
      const stopBtn = win.locator('button[aria-label^="Stop"], button[aria-label^="停止"]').first()
      await stopBtn.waitFor({ state: 'visible', timeout: 15_000 })
      await stopBtn.click()

      // Immediately send the replacement message without waiting for any artificial cooldown.
      await agent.send('fast replacement')
      await expect(win.getByText('fresh-ok: fast replacement').first()).toBeVisible({ timeout: 30_000 })

      // User message must not appear duplicated on the timeline.
      expect(await win.locator('.timeline-user-bubble').filter({ hasText: 'fast replacement' }).count()).toBe(1)
    } finally {
      await agent.close()
      model.close()
    }
  })

  test('rewind while streaming auto-aborts and re-populates composer cleanly', async () => {
    const model = startScriptedModel((_first, _tools, last) => {
      if (last.includes('second busy turn')) {
        return { delayMs: 8000, text: 'long busy reply' }
      }
      return { text: `ok ${last}` }
    }, [])

    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      await agent.newSession()
      await agent.send('turn one')
      await expect(win.getByText('ok turn one').first()).toBeVisible({ timeout: 30_000 })

      await agent.send('second busy turn')
      await win.locator('button[aria-label^="Stop"], button[aria-label^="停止"]').first().waitFor({
        state: 'visible',
        timeout: 15_000,
      })

      const firstUserRow = win.locator('[data-session-entry-id]').filter({
        has: win.locator('.timeline-user-bubble', { hasText: 'turn one' }),
      }).first()
      await firstUserRow.locator('.timeline-user-bubble').hover()
      const rewindBtn = firstUserRow.locator('button[title*="Jump"], button[title*="Rewind"], button[title*="回退"], button[title*="跳转"]').first()
      await rewindBtn.waitFor({ state: 'visible', timeout: 5_000 })
      await rewindBtn.click()

      await expect(win.locator('[contenteditable="true"]').last()).toContainText('turn one', {
        timeout: 15_000,
      })
      await expect(win.getByText('ok turn one')).toHaveCount(0, { timeout: 15_000 })

      // Re-sending after busy rewind must work immediately.
      await agent.send(' updated')
      await expect(win.getByText(/fresh|ok turn one updated/).first()).toBeVisible({ timeout: 30_000 })
    } finally {
      await agent.close()
      model.close()
    }
  })
})
