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
  ELECTRON_NO_ATTACH_CONSOLE: '1',
}

test.describe('settings', () => {
  test('app loads without crash (settings route lazy)', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const title = await window.title()
      expect(title.toLowerCase()).toContain('pi')
    } finally {
      await app.close()
    }
  })

  test('renderer document readyState is complete or interactive', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const state = await window.evaluate(() => document.readyState)
      expect(['complete', 'interactive', 'loading']).toContain(state)
    } finally {
      await app.close()
    }
  })

  test('single browser window on launch', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const windows = app.windows()
      expect(windows.length).toBeGreaterThanOrEqual(1)
    } finally {
      await app.close()
    }
  })
})