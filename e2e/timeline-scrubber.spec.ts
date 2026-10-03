import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long answer that fills the screen.`).join('\n\n')

test.describe('timeline scrubber', () => {
  test.setTimeout(180_000)

  test('jumps between user messages by click, drag and keyboard', async () => {
    const seen: Seen[] = []
    const model = startScriptedModel((first) => ({ text: `Answer to ${first.slice(0, 12)}\n\n${LONG}` }), seen)
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
    } finally {
      await agent.close()
      model.close()
    }
  })
})
