import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

/** One assistant reply as pi records it (the shape `usage-scan` reads). */
function reply(id: string, ts: number, provider: string, model: string, usage: { input: number; output: number; cacheRead: number; cost: number }): string {
  return JSON.stringify({
    type: 'message',
    id,
    timestamp: new Date(ts).toISOString(),
    message: {
      role: 'assistant',
      provider,
      model,
      timestamp: ts,
      content: 'x',
      usage: { ...usage, cacheWrite: 0, reasoning: 0, cost: { total: usage.cost } },
    },
  })
}

test.describe('status bar usage', () => {
  test.setTimeout(200_000)

  test('shows today cost and tokens, and the per-model breakdown in the popover', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-usage-'))
    const project = path.join(home, 'code', 'demo')
    fs.mkdirSync(project, { recursive: true })
    const sessions = path.join(home, '.pi', 'agent', 'sessions', '--probe--')
    fs.mkdirSync(sessions, { recursive: true })
    const now = Date.now()
    fs.writeFileSync(
      path.join(sessions, 'a.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 's1', cwd: project, timestamp: new Date(now - 3_600_000).toISOString() }),
        JSON.stringify({ type: 'message', id: 'u1', timestamp: new Date(now - 3_500_000).toISOString(), message: { role: 'user', content: 'usage probe' } }),
        reply('a1', now - 3_000_000, 'anthropic', 'claude-sonnet-5', { input: 210_000, output: 52_000, cacheRead: 900_000, cost: 1.24 }),
        reply('a2', now - 2_000_000, 'deepseek', 'deepseek-v4.1-flash', { input: 8_000_000, output: 120_000, cacheRead: 22_000_000, cost: 0.61 }),
      ].join('\n') + '\n',
    )

    const model = startScriptedModel((_first, _tools, last) => ({ text: `reply to ${last.slice(0, 12)}` }), [])
    const { app, win } = await launchAgentApp(await listen(model), { home, keepHome: true })
    try {
      const chip = win.getByRole('button', { name: "Today's usage" })
      await expect(chip).toContainText('$1.85')
      await expect(chip).toContainText('31.3M')

      await chip.click()
      const dialog = win.getByRole('dialog')
      await expect(dialog).toContainText('Cost today')
      await expect(dialog).toContainText('Replies')
      await expect(dialog).toContainText('1 reply')
      await expect(dialog).toContainText('claude-sonnet-5')
      await expect(dialog).toContainText('anthropic')
      await expect(dialog).toContainText('deepseek-v4.1-flash')

      // Escape closes it and leaves the footer chip as the only usage surface.
      await win.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    } finally {
      await app.close()
    }
  })
})
