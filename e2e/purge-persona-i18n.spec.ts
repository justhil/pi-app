import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

// Display-copy check for the localized built-in Purge personas.
const RU = JSON.parse(fs.readFileSync('src/renderer/src/locales/ru/composer.json', 'utf8')).purge
const EN = JSON.parse(fs.readFileSync('src/renderer/src/locales/en/composer.json', 'utf8')).purge

async function openPurgeMenu(language: 'ru' | 'en') {
  const seen: Seen[] = []
  const model = startScriptedModel(() => ({ text: 'ok' }), seen)
  const agent = await launchAgentApp(await listen(model), { language })
  const win = agent.win
  const labels = language === 'ru' ? RU : EN
  await agent.newSession()
  await win.locator(`button[aria-label="${labels.choosePersona}"]`).first().click()
  await win.waitForTimeout(500)
  return { app: agent.app, win, labels }
}

test('the composer persona menu speaks Russian', async () => {
  test.setTimeout(150_000)
  const { app, win } = await openPurgeMenu('ru')
  try {
    await expect(win.getByText('Коната · исполнение в песочнице').first()).toBeVisible()
    await expect(win.getByText('CTF-песочница · пять фаз').first()).toBeVisible()
    await expect(win.getByText('Нейтральный шаблон').first()).toBeVisible()
    await win.screenshot({ path: path.join('artifacts', 'locale-ru', 'purge-personas-ru.png') })
  } finally {
    await app.close()
  }
})

test('the composer persona menu keeps the English copy', async () => {
  test.setTimeout(150_000)
  const { app, win } = await openPurgeMenu('en')
  try {
    await expect(win.getByText('Konata · Sandbox execution').first()).toBeVisible()
    await expect(win.getByText('Neutral template').first()).toBeVisible()
    await win.screenshot({ path: path.join('artifacts', 'locale-ru', 'purge-personas-en.png') })
  } finally {
    await app.close()
  }
})
