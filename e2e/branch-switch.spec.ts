import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test.describe('branch switcher', () => {
  test.setTimeout(120_000)

  test('status bar shows the branch, switches, and stashes conflicting changes on request', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-branch-'))
    const project = path.join(home, 'code', 'demo')
    fs.mkdirSync(project, { recursive: true })
    const git = (...args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    for (const [k, v] of [['user.name', 'T'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false']]) git('config', k, v)
    fs.writeFileSync(path.join(project, 'README.md'), '# demo\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    git('switch', '-qc', 'feature/login')
    fs.writeFileSync(path.join(project, 'README.md'), '# demo on feature\n')
    git('commit', '-qam', 'feature')
    git('switch', '-q', 'main')

    const model = startScriptedModel(() => ({ text: 'ok' }), [])
    const agent = await launchAgentApp(await listen(model), { home })
    const { win } = agent
    try {
      const trigger = win.locator('.branch-status-trigger')
      await agent.newSession()
      await expect(trigger).toContainText('main', { timeout: 15_000 })

      await trigger.click()
      const popover = win.getByRole('dialog', { name: 'Branches' })
      await expect(popover.getByRole('option', { name: /feature\/login/ })).toBeVisible()
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-branches.png') })
      await win.keyboard.type('login')
      await expect(popover.getByPlaceholder('Find a branch…')).toBeFocused()
      await win.keyboard.press('Enter')
      await expect(trigger).toContainText('feature/login', { timeout: 15_000 })
      expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/login')

      // A local edit the switch would overwrite: asked, stashed, switched; offered back on return.
      fs.writeFileSync(path.join(project, 'README.md'), '# my edit\n')
      await trigger.click()
      await popover.getByRole('option', { name: /^main/ }).click()
      const dialog = win.getByRole('dialog', { name: 'Uncommitted changes would be overwritten' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Stash and switch' }).click()
      await expect(trigger).toContainText('main', { timeout: 15_000 })
      expect(fs.readFileSync(path.join(project, 'README.md'), 'utf8')).toBe('# demo\n')

      await trigger.click()
      await popover.getByRole('option', { name: /feature\/login/ }).click()
      await expect(trigger).toContainText('feature/login', { timeout: 15_000 })
      await win.getByRole('button', { name: 'Restore' }).click()
      await expect.poll(() => fs.readFileSync(path.join(project, 'README.md'), 'utf8')).toBe('# my edit\n')
      await expect(trigger.locator('.rounded-full')).toBeVisible()

      // New branch from the picker.
      await trigger.click()
      await popover.getByRole('button', { name: 'New branch…' }).click()
      await popover.getByPlaceholder('New branch name').fill('fix/typo')
      await win.keyboard.press('Enter')
      await expect(trigger).toContainText('fix/typo', { timeout: 15_000 })
    } finally {
      await agent.close()
      model.close()
    }
  })
})
