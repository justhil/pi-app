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

      // One paper layer only: the chat column inside the strip must not draw a second rounded
      // corner with its own shadow, which showed as a double corner and a seam in light mode.
      const painted = await win.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.main-chat-column')].filter((el) => {
          const cs = getComputedStyle(el)
          return cs.borderTopLeftRadius !== '0px' || cs.boxShadow !== 'none'
        }).length,
      )
      expect(painted).toBe(1)
    } finally {
      await agent.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
  test('renders Markdown as rich text and scrolls the tab strip', async () => {
    test.setTimeout(200_000)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-md-'))
    const project = path.join(home, 'code', 'demo')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'notes.md'), '# Heading one' + String.fromCharCode(10) + 'body text')
    // 3500 headings is past the rich-render limit, so the file opens as source with a button.
    fs.writeFileSync(path.join(project, 'big.md'), Array.from({ length: 3500 }, (_v, i) => '## section ' + i).join(String.fromCharCode(10)))
    for (let i = 1; i <= 10; i += 1) fs.writeFileSync(path.join(project, 'doc-' + i + '.md'), '# doc ' + i)
    const model = startScriptedModel((_first, _tools, last) => ({ text: 'reply to ' + last.slice(0, 14) }), [])
    const agent = await launchAgentApp(await listen(model), { home, keepHome: true })
    const { win } = agent
    try {
      await agent.newSession()
      await win.locator('[data-right-panel-toggle]').click()
      await win.locator('[data-panel-tab="files"]').click()

      // Markdown is rendered, not shown as literal '#' source.
      await win.getByText('notes.md').click()
      await expect(win.locator('.prose-chat h1', { hasText: 'Heading one' })).toBeVisible({ timeout: 15_000 })
      await expect(win.getByText('# Heading one')).toHaveCount(0)

      // Past the limit: source first, one click to render it anyway.
      await win.getByText('big.md').click()
      const render = win.getByRole('button', { name: /Render anyway|仍然渲染/ })
      await expect(render).toBeVisible({ timeout: 10_000 })
      await render.click()
      await expect(win.locator('.prose-chat h2').first()).toBeVisible({ timeout: 20_000 })

      // Tabs keep the strip one line high, so the wheel has to move it sideways.
      for (let i = 1; i <= 10; i += 1) await win.getByText('doc-' + i + '.md').click()
      const strip = win.locator('[aria-label="Open files"]')
      const before = await strip.evaluate((el) => el.scrollLeft)
      const box = (await strip.boundingBox())!
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await win.mouse.wheel(0, 240)
      await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before)
    } finally {
      await agent.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
