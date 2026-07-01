import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out/main/index.js')

test.describe('pi Desktop smoke', () => {
  test('launches built app and shows window', async () => {
    test.setTimeout(120_000)
    const app = await electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
    })
    try {
      const window = await app.firstWindow({ timeout: 90_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 60_000 })
      const title = await window.title()
      expect(title.toLowerCase()).toContain('pi')
    } finally {
      await app.close()
    }
  })

  test('launches with sandbox disabled via PI_RENDERER_SANDBOX=0', async () => {
    test.setTimeout(120_000)
    const app = await electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        PI_RENDERER_SANDBOX: '0',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
    })
    try {
      const window = await app.firstWindow({ timeout: 90_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 60_000 })
      expect(await window.title()).toBeTruthy()
    } finally {
      await app.close()
    }
  })
})