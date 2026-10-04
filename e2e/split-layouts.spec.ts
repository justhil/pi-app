import { test, expect, type Page } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function rects(win: Page) {
  // Panes animate to their new place (160 ms).
  await win.waitForTimeout(300)
  return win.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.split-view > [data-split-pane]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.splitPane!, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), active: el.hasAttribute('data-active') }
    }),
  )
}

test.describe('split layouts (tmux style)', () => {
  test.setTimeout(200_000)

  test('split right / down, grid preset, snapping resize, cards and swap', async () => {
    const model = startScriptedModel((_f, _t, last) => ({ text: `answer about ${last}` }), [])
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    const panes = win.locator('.split-view > [data-split-pane]')
    try {
      await agent.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1700, 1050))
      await agent.newSession()
      await agent.send('ALPHA question')
      await expect(win.getByText('answer about ALPHA question').first()).toBeVisible({ timeout: 30_000 })

      // Ctrl+\ splits right, Ctrl+Shift+\ splits the new pane down.
      await win.locator('body').click({ position: { x: 5, y: 500 } })
      await win.keyboard.press(`${MOD}+Backslash`)
      await expect(panes).toHaveCount(2)
      await win.keyboard.press(`${MOD}+Shift+Backslash`)
      await expect(panes).toHaveCount(3)
      let r = await rects(win)
      const [a, b, c] = r.sort((p, q) => p.x - q.x || p.y - q.y)
      expect(b.x).toBe(c.x)
      expect(c.y).toBeGreaterThan(b.y + 100)
      expect(a.h).toBeGreaterThan(b.h + 100)

      // A fourth pane, then the grid preset from a pane's layout menu.
      await win.keyboard.press(`${MOD}+Backslash`)
      await expect(panes).toHaveCount(4)
      const header = panes.first().locator('.split-pane-header')
      await header.hover()
      await header.getByRole('button', { name: 'Split and layout' }).click()
      await win.locator('[data-split-menu]').getByRole('menuitem', { name: 'Grid' }).click()
      r = await rects(win)
      const xs = new Set(r.map((p) => p.x))
      const ys = new Set(r.map((p) => p.y))
      expect(xs.size).toBe(2)
      expect(ys.size).toBe(2)

      // Drag the vertical divider of the top row towards a third: it snaps and shows "1/3".
      const handle = win.locator('[data-split-handle]').nth(1)
      const hb = (await handle.boundingBox())!
      const top = r.filter((p) => p.y === Math.min(...ys)).sort((p, q) => p.x - q.x)
      const rowW = top[1].x + top[1].w - top[0].x
      await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
      await win.mouse.down()
      await win.mouse.move(top[0].x + rowW / 3 + 6, hb.y + hb.height / 2, { steps: 8 })
      await expect(win.locator('.split-guide-label')).toHaveText('1/3')
      await win.mouse.up()
      const afterTop = (await rects(win)).filter((p) => p.y === Math.min(...ys)).sort((p, q) => p.x - q.x)
      expect(Math.abs(afterTop[0].w / (afterTop[0].w + afterTop[1].w) - 1 / 3)).toBeLessThan(0.01)

      // Main-left, then widen the main pane: the narrow stacked panes become status cards.
      await header.hover()
      await header.getByRole('button', { name: 'Split and layout' }).click()
      await win.locator('[data-split-menu]').getByRole('menuitem', { name: 'Main left' }).click()
      await win.waitForTimeout(300)
      const mainHandle = (await win.locator('[data-split-handle]').first().boundingBox())!
      const area = (await win.locator('.split-view').boundingBox())!
      await win.mouse.move(mainHandle.x + 3, mainHandle.y + mainHandle.height / 2)
      await win.mouse.down()
      await win.mouse.move(area.x + area.width * 0.72, mainHandle.y + mainHandle.height / 2, { steps: 6 })
      await win.mouse.up()
      await win.waitForTimeout(400)
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-split.png') })
      await expect(win.locator('[data-pane-card]')).toHaveCount(3, { timeout: 5000 })
      await expect(win.locator('[data-pane-card]').filter({ hasText: 'ALPHA question' })).toContainText('answer about ALPHA question')

      // Drag a pane header onto another pane's middle: they swap places.
      r = await rects(win)
      const main = r.find((p) => p.active)!
      const side = r.filter((p) => !p.active).sort((p, q) => p.y - q.y)[1]
      await win.locator(`[data-split-pane="${side.id}"] .split-pane-header`).dragTo(win.locator(`[data-split-pane="${main.id}"]`), {
        targetPosition: { x: main.w / 2, y: main.h / 2 },
      })
      const swapped = await rects(win)
      expect(swapped.find((p) => p.id === side.id)).toMatchObject({ x: main.x, y: main.y })

    } finally {
      await agent.close()
      model.close()
    }
  })
})
