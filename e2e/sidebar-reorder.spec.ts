import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test('conversations and projects can be dragged into a new order', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-reorder-'))
  const project = path.join(home, 'code', 'demo')
  const other = path.join(home, 'code', 'other')
  fs.mkdirSync(other, { recursive: true })
  const model = startScriptedModel((_first, _tools, last) => ({ text: `ok ${last}` }), [])
  const agent = await launchAgentApp(await listen(model), { home, config: { recentProjects: [project, other], recentProjectsFixedOrder: true } })
  const { win } = agent
  // Windows paths carry backslashes, which a CSS attribute selector reads as escapes.
  const at = (dir: string) => `[data-workspace="${dir.replace(/\\/g, '\\\\')}"]`
  const rows = win.locator(`${at(project)} [data-session-file]`)
  const row = (text: string) => rows.filter({ hasText: text }).first()
  const order = async () => (await rows.allInnerTexts()).map((text) => text.split('\n')[0].trim())
  const top = { x: 60, y: 4 }
  try {
    for (const topic of ['first topic', 'second topic', 'third topic']) {
      await agent.newSession()
      await agent.send(topic)
      await expect(win.getByText(`ok ${topic}`).first()).toBeVisible({ timeout: 30_000 })
    }
    await expect.poll(order).toEqual(['third topic', 'second topic', 'first topic'])

    // Ensure the Electron window holds OS focus before HTML5 drag synthesis in multi-spec runs.
    await win.bringToFront()
    // Drop the oldest conversation on the top half of the newest one.
    await row('first topic').dragTo(row('third topic'), { targetPosition: top })
    await expect.poll(order).toEqual(['first topic', 'third topic', 'second topic'])

    // The dragged order survives the lists being read again.
    const reload = async () => {
      await win.getByRole('button', { name: /Reload session and project lists/ }).click()
      await win.waitForTimeout(1500)
    }
    await reload()
    await expect.poll(order).toEqual(['first topic', 'third topic', 'second topic'])

    // A new message still sends a conversation to the top once the list is read again (the
    // sidebar never reordered live, dragged or not); the dragged one keeps its place below.
    await row('second topic').click()
    await win.waitForTimeout(800)
    await agent.send('more')
    await expect(win.getByText('ok more').first()).toBeVisible({ timeout: 30_000 })
    await reload()
    await expect.poll(order).toEqual(['second topic', 'first topic', 'third topic'])

    // Projects: drop the second folder above the first, and the stored list follows.
    const header = (dir: string) => win.locator(`${at(dir)} > .nav-row`)
    await header(other).dragTo(header(project), { targetPosition: top })
    const shown = async () => win.locator('[data-workspace]').evaluateAll((els) => els.map((el) => el.getAttribute('data-workspace')))
    await expect.poll(shown).toEqual([other, project])
    const stored = () => JSON.parse(fs.readFileSync(path.join(home, '.config', 'Electron', 'pi-desktop.json'), 'utf8')).recentProjects
    await expect.poll(stored).toEqual([other, project])
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
  } finally {
    await agent.close()
    model.close()
  }
})
