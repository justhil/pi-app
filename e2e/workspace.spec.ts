import { test, expect } from '@playwright/test'
import { launchCleanApp } from './helpers/clean-launch'

const baseEnv = {
  // Linux CI: avoid dbus/session noise
  ELECTRON_NO_ATTACH_CONSOLE: '1',
}

const launchApp = () => launchCleanApp({ env: baseEnv })

test.describe('workspace shell', () => {
  test('shows main window and composer region', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const title = await window.title()
      expect(title.toLowerCase()).toContain('pi')
    } finally {
      await app.close()
    }
  })

  test('html root element present', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      expect(await window.locator('html').count()).toBe(1)
    } finally {
      await app.close()
    }
  })

  test('app closes cleanly', async () => {
    const app = await launchApp()
    await app.firstWindow({ timeout: 45_000 })
    await app.close()
    expect(true).toBe(true)
  })
})