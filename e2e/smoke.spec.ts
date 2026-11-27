import { test, expect } from '@playwright/test'
import { launchCleanApp } from './helpers/clean-launch'

const baseEnv = {
  // Linux CI: avoid dbus/session noise
  ELECTRON_NO_ATTACH_CONSOLE: '1',
}

async function launchApp(extraEnv: Record<string, string> = {}) {
  return launchCleanApp({ env: { ...baseEnv, ...extraEnv } })
}

test.describe('pi Desktop smoke', () => {
  test('launches built app and shows window', async () => {
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

  test('window has document root after load', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const root = await window.evaluate(() => !!document.documentElement)
      expect(root).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('launches with sandbox disabled via PI_RENDERER_SANDBOX=0', async () => {
    const app = await launchApp({ PI_RENDERER_SANDBOX: '0' })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      expect(await window.title()).toBeTruthy()
    } finally {
      await app.close()
    }
  })
})