import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out/main/index.js')

const baseEnv = {
  ...process.env,
  PI_E2E: '1',
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  // Linux CI: avoid dbus/session noise
  ELECTRON_NO_ATTACH_CONSOLE: '1',
}

async function launchApp(extraEnv: Record<string, string> = {}) {
  return electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: { ...baseEnv, ...extraEnv },
    timeout: 60_000,
  })
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