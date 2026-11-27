import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchCleanApp } from './helpers/clean-launch'

for (const language of ['en', 'zh'] as const) {
  test(`large project session lists expand and collapse without pushing away the next project (${language})`, async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-sidebar-'))
    const agentDir = path.join(temp, 'agent')
    const project = path.join(temp, 'large-project')
    const nextProject = path.join(temp, 'next-project')
    const sessionDir = path.join(agentDir, 'sessions', `--${project.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.mkdirSync(project)
    fs.mkdirSync(nextProject)
    const now = Date.now()
    for (let i = 0; i < 125; i++) {
      const timestamp = now - i * 60_000
      fs.writeFileSync(path.join(sessionDir, `conversation-${i}.jsonl`), [
        { type: 'session', version: 3, id: `session-${i}`, timestamp: new Date(timestamp).toISOString(), cwd: project },
        { type: 'message', id: `user-${i}`, parentId: null, timestamp: new Date(timestamp).toISOString(), message: { role: 'user', content: [{ type: 'text', text: `Conversation ${i}` }], timestamp } },
      ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    }
    const app = await launchCleanApp({
      language,
      env: { PI_CODING_AGENT_DIR: agentDir },
      config: { currentProject: project, recentProjects: [project, nextProject], recentProjectsFixedOrder: true, theme: language === 'zh' ? 'dark' : 'light' },
    })
    try {
      const win = await app.firstWindow()
      await win.setViewportSize({ width: language === 'zh' ? 1000 : 1400, height: 800 })
      await win.getByRole('button', { name: 'large-project', exact: true }).focus()
      await win.keyboard.press('Enter')
      const projectRow = win.locator('.sidebar-project-row').filter({ hasText: 'large-project' })
      const list = projectRow.locator('.sidebar-session-list')
      const showMore = language === 'zh' ? '显示更多（120）' : 'Show more (120)'
      const showLess = language === 'zh' ? '收起' : 'Show less'
      const toggle = projectRow.getByRole('button', { name: showMore, exact: true })
      await expect(toggle).toBeVisible({ timeout: 30_000 })
      await expect(list.locator(':scope > [data-session-file]')).toHaveCount(5)
      await win.screenshot({ path: test.info().outputPath('collapsed.png'), animations: 'disabled' })

      await toggle.focus()
      await win.keyboard.press('Enter')
      const collapse = projectRow.getByRole('button', { name: showLess, exact: true })
      await expect(collapse).toBeFocused()
      await expect(collapse).toHaveAttribute('aria-expanded', 'true')
      await expect(list.locator(':scope > [data-session-file]')).toHaveCount(125)
      expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight && element.clientHeight <= 320)).toBe(true)
      const next = win.locator('.sidebar-project-row').getByRole('button', { name: 'next-project', exact: true })
      await expect(next).toBeInViewport()
      await list.hover()
      await win.mouse.wheel(0, 900)
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      await expect(collapse).toBeInViewport()
      await expect(next).toBeInViewport()
      await win.screenshot({ path: test.info().outputPath('expanded.png'), animations: 'disabled' })

      await collapse.focus()
      await win.keyboard.press('Space')
      await expect(projectRow.getByRole('button', { name: showMore, exact: true })).toBeFocused()
      await expect(list.locator(':scope > [data-session-file]')).toHaveCount(5)

      await win.locator('[data-pi-slot="sidebar-search-trigger"]').click()
      const search = win.getByRole('searchbox')
      await search.fill('Conversation')
      await expect(list.locator(':scope > [data-session-file]')).toHaveCount(125)
      await expect(projectRow.getByRole('button', { name: showMore, exact: true })).toHaveCount(0)
      await search.clear()
      await expect(list.locator(':scope > [data-session-file]')).toHaveCount(5)
      await next.focus()
      await win.keyboard.press('Enter')
      await expect(next).toHaveAttribute('aria-current', 'location')
    } finally {
      await app.close()
      fs.rmSync(temp, { recursive: true, force: true })
    }
  })
}
