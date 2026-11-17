import { test, expect } from '@playwright/test'
import { launchCleanApp } from './helpers/clean-launch'

const baseEnv = {
  // Linux CI: avoid dbus/session noise
  ELECTRON_NO_ATTACH_CONSOLE: '1',
}

const launchApp = () => launchCleanApp({ env: baseEnv })

test.describe('composer', () => {
  test('input area is focusable when present', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const textarea = window.locator('textarea, [contenteditable="true"]').first()
      const count = await textarea.count()
      if (count > 0) {
        await textarea.focus()
        expect(await textarea.evaluate((el) => document.activeElement === el)).toBeTruthy()
      } else {
        expect(await window.title()).toBeTruthy()
      }
    } finally {
      await app.close()
    }
  })

  test('window title contains pi after launch', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      expect((await window.title()).toLowerCase()).toContain('pi')
    } finally {
      await app.close()
    }
  })

  test('body element exists in renderer', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      expect(await window.locator('body').count()).toBe(1)
    } finally {
      await app.close()
    }
  })
})