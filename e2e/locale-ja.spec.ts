import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { launchCleanApp } from './helpers/clean-launch'

test('switches to Japanese and restores it after a reload', async ({}, testInfo) => {
  const homeDir = testInfo.outputPath('home')
  const agentDir = testInfo.outputPath('pi-agent')
  mkdirSync(homeDir, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  const app = await launchCleanApp({
    language: 'en',
    env: { HOME: homeDir, USERPROFILE: homeDir, PI_CODING_AGENT_DIR: agentDir },
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
    await page.getByRole('button', { name: '日本語', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.getByRole('button', { name: '外観', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('すべての変更を保存しました', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('settings-ja.png') })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.getByRole('button', { name: '設定', exact: true }).first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('home-ja.png') })
  } finally {
    await app.close()
  }
})
