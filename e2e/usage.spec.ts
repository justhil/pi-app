import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

/** A session file with three priced replies today and one a week ago. */
function seedSessions(home: string): void {
  const dir = path.join(home, '.pi', 'agent', 'sessions', '--seeded-usage--')
  fs.mkdirSync(dir, { recursive: true })
  const now = Date.now()
  const reply = (ts: number, model: string, input: number, output: number, cacheRead: number, cost: number) =>
    JSON.stringify({ type: 'message', id: `a${ts}`, parentId: null, timestamp: new Date(ts).toISOString(), message: { role: 'assistant', provider: 'mock', model, timestamp: ts, content: [], usage: { input, output, cacheRead, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } } } })
  fs.writeFileSync(
    path.join(dir, '2026-10-01_usage.jsonl'),
    [
      JSON.stringify({ type: 'session', version: 3, id: 'usage', timestamp: new Date(now).toISOString(), cwd: path.join(home, 'code', 'demo') }),
      JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: new Date(now).toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'Seeded usage question' }], timestamp: now } }),
      reply(now - 60_000, 'big-model', 12_000, 3_000, 40_000, 1.25),
      reply(now - 30_000, 'big-model', 1_000, 500, 50_000, 0.5),
      reply(now - 10_000, 'small-model', 800, 200, 0, 0.01),
      reply(now - 6 * 86_400_000, 'small-model', 100, 100, 0, 0.02),
    ].join('\n') + '\n',
  )
  // Older activity for the 90-day views, and a fork that copies the first reply (counted once).
  const older = Array.from({ length: 40 }, (_, i) => reply(now - (10 + i * 2) * 86_400_000 - i * 3_600_000, i % 3 ? 'small-model' : 'big-model', 2000 + i * 100, 400, 8000, 0.05 + (i % 5) * 0.04))
  fs.writeFileSync(path.join(dir, '2026-08-01_old.jsonl'), [JSON.stringify({ type: 'session', version: 3, id: 'old', timestamp: new Date(now - 90 * 86_400_000).toISOString(), cwd: path.join(home, 'code', 'demo') }), ...older].join('\n') + '\n')
}

test.describe('usage settings', () => {
  test.setTimeout(120_000)

  test('shows cost and tokens by model, project and session for a range', async () => {
    const model = startScriptedModel(() => ({ text: 'ok' }), [])
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      seedSessions(agent.home)
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Usage', { exact: true }).first().click()
      await expect(win.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true')
      await expect(win.getByText('$1.78').first()).toBeVisible({ timeout: 20_000 })
      await expect(win.getByText('mock/big-model')).toBeVisible()
      await expect(win.getByText('Seeded usage question')).toBeVisible()
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-usage.png'), fullPage: true })
      // Hovering one layer of a bar names that layer.
      const bar = win.locator('.settings-row .h-40 > div').last()
      await bar.locator('div > div').first().hover()
      await expect(win.getByText(/^Input 13\.8K/)).toBeVisible()
      await win.getByRole('radio', { name: 'Today' }).click()
      await expect(win.getByText('$1.76').first()).toBeVisible({ timeout: 10_000 })
      await win.getByRole('radio', { name: '90 days' }).click()
      await expect(win.getByText('By weekday and hour (local time)')).toBeVisible({ timeout: 10_000 })
      if (process.env.SHOT) {
        await win.getByText('Activity', { exact: true }).scrollIntoViewIfNeeded()
        await win.screenshot({ path: process.env.SHOT.replace('.png', '-usage-heat.png') })
      }
    } finally {
      await agent.close()
      model.close()
    }
  })
})
