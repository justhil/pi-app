import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

// Extensions such as magic-context register their composer widget once, from session_start,
// and later only call requestRender. That registration must reach the live widget host.
const EXTENSION = `
export default function (pi) {
  pi.on('session_start', async (_event, ctx) => {
    if (!ctx.hasUI) return
    ctx.ui.setWidget('magic-context-todos', () => ({
      render: () => [
        '● Todos — 1/2 completed · 1 in progress',
        '├─ ✓ #t1 Seeded from storage',
        '└─ ◐ #t2 Still running',
      ],
      invalidate: () => {},
    }), { placement: 'aboveEditor' })
  })
}
`

test('a widget registered at session_start shows above the composer with parsed statuses', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-widget-'))
  const extensions = path.join(home, '.pi', 'agent', 'extensions')
  fs.mkdirSync(extensions, { recursive: true })
  fs.writeFileSync(path.join(extensions, 'session-start-widget.ts'), EXTENSION)

  const model = startScriptedModel(() => ({ text: 'ok' }), [])
  const agent = await launchAgentApp(await listen(model), { home })
  const { win } = agent
  try {
    await agent.newSession()
    await agent.send('hello')
    await expect(win.getByText('ok').first()).toBeVisible({ timeout: 30_000 })
    await win.locator('.adapter-widget-trigger').click({ timeout: 20_000 })
    const list = win.locator('.adapter-widget-list')
    await expect(list).toContainText('Still running', { timeout: 20_000 })
    await expect(list).toContainText('Seeded from storage')
    await expect(list).not.toContainText('Todos —')
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })
  } finally {
    await agent.close()
    model.close()
  }
})
