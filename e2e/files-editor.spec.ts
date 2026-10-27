import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test.describe('files panel and main-column editor', () => {
  test.setTimeout(200_000)

  test('shows hidden files by default and opens a clicked file as a tab', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-files-'))
    const project = path.join(home, 'code', 'demo')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'README.md'), '# demo\n')
    fs.writeFileSync(path.join(project, '.hidden-notes.md'), 'hidden\n')
    fs.writeFileSync(path.join(project, 'visible.md'), 'visible file body\n')

    const model = startScriptedModel((_first, _tools, last) => ({ text: `reply to ${last.slice(0, 14)}` }), [])
    const agent = await launchAgentApp(await listen(model), { home, keepHome: true })
    const { win } = agent
    try {
      // Files explorer: hidden entries are part of the tree until the eye button hides them.
      await agent.newSession()
      await win.locator('[data-right-panel-toggle]').click()
      await win.locator('[data-panel-tab="files"]').click()
      await expect(win.getByText('visible.md')).toBeVisible({ timeout: 15_000 })
      await expect(win.getByText('.hidden-notes.md')).toBeVisible()
      const eye = win.getByRole('button', { name: /Hide hidden files|隐藏隐藏文件/ })
      await eye.click()
      await expect(win.getByText('.hidden-notes.md')).toHaveCount(0)

      // Clicking a file opens it in the main column, not in a side preview.
      await win.getByText('visible.md').click()
      await expect(win.getByRole('tab', { name: 'visible.md' })).toBeVisible({ timeout: 10_000 })
      await expect(win.getByText('visible file body')).toBeVisible()
      await expect(win.locator('[data-composer-shell]')).toBeHidden()

      // Escape returns to the chat; the editor tab stays available.
      await win.keyboard.press('Escape')
      await expect(win.locator('[data-composer-shell]')).toBeVisible()
      await expect(win.getByRole('tab', { name: 'visible.md' })).toBeVisible()

      // The strip lives on the chat surface: both top strips start at the same y, so the side
      // panels do not look taller than the main column.
      const tops = await win.evaluate(() => {
        const top = (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null
          return el ? +el.getBoundingClientRect().top.toFixed(1) : null
        }
        return { strip: top('[aria-label="Open files"]'), panel: top('.right-panel-tabs-wrap'), paper: top('.main-chat-column') }
      })
      expect(tops.strip).toBe(tops.panel)
      expect(tops.paper).toBe(tops.strip)
    } finally {
      await agent.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
