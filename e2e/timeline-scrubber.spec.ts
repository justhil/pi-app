import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long answer that fills the screen.`).join('\n\n')

test.describe('timeline scrubber', () => {
  test.setTimeout(180_000)

  test('jumps between user messages by click, drag and keyboard', async () => {
    const seen: Seen[] = []
    // The last answer is short: at the bottom its question sits low in the viewport.
    const model = startScriptedModel((first, _t, last) => ({ text: last.includes('QUESTION-8') ? 'Short answer.' : `Answer to ${first.slice(0, 12)}\n\n${LONG}` }), seen)
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      await agent.newSession()
      for (let i = 1; i <= 8; i++) {
        await agent.send(`QUESTION-${i} about part ${i}`)
        await expect.poll(() => seen.filter((s) => s.firstUser.includes('QUESTION-1')).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(i)
        await win.waitForTimeout(600)
      }
      const rail = win.locator('[data-timeline-scrubber]')
      await expect(rail).toBeVisible()
      await expect(rail.locator('.timeline-scrubber-mark')).toHaveCount(8)
      // At the bottom the reader is at the last question.
      await expect(rail).toHaveAttribute('aria-valuenow', '8')

      const inView = (text: string) =>
        win.evaluate((t) => {
          const el = [...document.querySelectorAll('[data-item-id]')].find((n) => n.textContent?.includes(t))
          if (!el) return false
          const r = el.getBoundingClientRect()
          return r.bottom > 0 && r.top < innerHeight
        }, text)

      // Hover shows a preview of the nearest message.
      const box = (await rail.boundingBox())!
      await win.mouse.move(box.x + box.width / 2, box.y + 7)
      await expect(rail.getByText('QUESTION-1 about part 1')).toBeVisible()

      // Click jumps there.
      await win.mouse.down()
      await win.mouse.up()
      await expect.poll(() => inView('QUESTION-1 about part 1')).toBe(true)
      await expect(rail).toHaveAttribute('aria-valuenow', '1')

      // Drag snaps through the marks; releasing in the middle lands on a middle question.
      await win.mouse.move(box.x + box.width / 2, box.y + 7)
      await win.mouse.down()
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
      await win.mouse.up()
      const mid = Number(await rail.getAttribute('aria-valuenow'))
      expect(mid).toBeGreaterThan(2)
      expect(mid).toBeLessThan(7)
      await expect.poll(() => inView(`QUESTION-${mid} about`)).toBe(true)

      // Keyboard: focused rail steps with arrows; Alt+arrows work from anywhere.
      await rail.focus()
      await win.keyboard.press('ArrowDown')
      await expect(rail).toHaveAttribute('aria-valuenow', String(mid + 1))
      await expect.poll(() => inView(`QUESTION-${mid + 1} about`)).toBe(true)
      await win.keyboard.press('End')
      await expect.poll(() => inView('QUESTION-8 about')).toBe(true)
      await win.locator('body').click({ position: { x: 5, y: 300 } })
      await win.keyboard.press('Alt+ArrowUp')
      await expect.poll(() => inView('QUESTION-7 about')).toBe(true)

      // Browsing never changed the conversation: sending continues after the last turn.
      const before = seen.length
      await agent.send('QUESTION-9 after browsing')
      await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThan(before)
      const last = seen.at(-1)!
      expect(last.firstUser).toContain('QUESTION-1')
      await expect(rail.locator('.timeline-scrubber-mark')).toHaveCount(9)

      // Leave and re-open the session from the sidebar: at the bottom the last question is current.
      await agent.newSession()
      await win.locator('[data-session-file]').filter({ hasText: 'QUESTION-1' }).locator('button').first().click()
      await expect(rail.locator('.timeline-scrubber-mark')).toHaveCount(9, { timeout: 15_000 })
      await expect(rail).toHaveAttribute('aria-valuenow', '9', { timeout: 5000 })
    } finally {
      await agent.close()
      model.close()
    }
  })

  test('an older session opened from disk tracks the reading position', async () => {
    const seen: Seen[] = []
    const model = startScriptedModel((_f, _t, last) => ({ text: last.includes('OLD-12') ? 'short' : `Answer\n\n${LONG}` }), seen)
    const port = await listen(model)
    let agent = await launchAgentApp(port, { keepHome: true })
    const home = agent.home
    try {
      await agent.newSession()
      for (let i = 1; i <= 12; i++) {
        await agent.send(`OLD-${i} question`)
        await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(i)
        await agent.win.waitForTimeout(400)
      }
    } finally {
      await agent.close()
    }
    // Restart: the session now comes from disk (loading skeleton first, no view cache).
    agent = await launchAgentApp(port, { home })
    const { win } = agent
    try {
      const row = win.locator('[data-session-file]').filter({ hasText: 'OLD-1 question' }).locator('button').first()
      if (!(await row.isVisible().catch(() => false))) await win.getByText('demo', { exact: true }).first().click()
      await row.click()
      const rail = win.locator('[data-timeline-scrubber]')
      await expect(rail.locator('.timeline-scrubber-mark')).toHaveCount(12, { timeout: 20_000 })
      await expect(rail).toHaveAttribute('aria-valuenow', '12', { timeout: 5000 })
      // Only the last 10 turns are mounted by default (setting: turns shown).
      const mounted = await win.evaluate(() => {
        const text = document.querySelector('.timeline-scroll-with-dock-pane')?.textContent ?? ''
        return [...new Set([...text.matchAll(/OLD-(\d+) question/g)].map((m) => m[1]))].sort((a, b) => Number(a) - Number(b))
      })
      expect(mounted).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    } finally {
      await agent.close()
      model.close()
    }
  })
})
