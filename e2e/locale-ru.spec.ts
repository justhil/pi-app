import { test, expect } from '@playwright/test'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

const SHOT_DIR = path.join('artifacts', 'locale-ru')

/**
 * Layout audit for the Russian UI. Russian labels are usually 1.5-2x longer than the
 * English ones, so every leaf text node is measured: an element whose text does not fit
 * its own box (scrollWidth > clientWidth) is reported. Elements that truncate with an
 * ellipsis on purpose, scrollable containers, code and the composer are skipped.
 */
const CLIPPED_TEXT_FN = `() => {
  const out = []
  const nodes = document.querySelectorAll('button, span, div, a, label, p, th, td, h1, h2, h3, summary, option')
  for (const el of nodes) {
    if (el.childElementCount > 0) continue
    const text = (el.textContent || '').trim()
    if (text.length < 2) continue
    const cs = getComputedStyle(el)
    if (cs.textOverflow === 'ellipsis') continue
    if (cs.overflowX !== 'visible') continue
    if (el.closest('pre, code, textarea, [contenteditable="true"]')) continue
    if (el.clientWidth === 0) continue
    if (el.scrollWidth <= el.clientWidth + 2) continue
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 70),
      text: text.slice(0, 70),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    })
  }
  return out
}`

const auditClip = (win) => win.evaluate(`(${CLIPPED_TEXT_FN})()`)

test.describe('Russian locale layout', () => {
  test('the app starts in Russian and labels are localized', async () => {
    test.setTimeout(150_000)
    const seen: Seen[] = []
    const model = startScriptedModel(() => ({ text: 'ok' }), seen)
    const agent = await launchAgentApp(await listen(model), { language: 'ru' })
    const { win } = agent
    try {
      expect(await win.evaluate(() => document.documentElement.lang)).toBe('ru')
      const editor = win.locator('[contenteditable="true"]').last()
      const placeholder = await editor.getAttribute('data-placeholder')
      expect(['Сообщение или / команда', 'Первое сообщение станет названием']).toContain(placeholder)
      await expect(win.locator('button[aria-label="Новая сессия"]').first()).toBeVisible()
      await expect(win.locator('button:has-text("Настройки")').first()).toBeVisible()
      await expect(win.locator('button[aria-label="Активность сессий"]').first()).toBeVisible()
      const chromeClip = await auditClip(win)
      expect(chromeClip, 'sidebar and composer chrome clip Russian labels').toEqual([])

      await win.locator('button:has-text("Настройки")').first().click()
      await expect(win.getByText('Основные', { exact: true }).first()).toBeVisible()
      await expect(win.getByText('Внешний вид', { exact: true }).first()).toBeVisible()
      await expect(win.getByText('Модели', { exact: true }).first()).toBeVisible()
      await win.screenshot({ path: path.join(SHOT_DIR, 'settings-general.png') })
      const generalClip = await auditClip(win)
      expect(generalClip, 'General section clips Russian labels').toEqual([])

      await win.getByText('Внешний вид', { exact: true }).first().click()
      await win.waitForTimeout(500)
      await win.screenshot({ path: path.join(SHOT_DIR, 'settings-appearance.png') })
      const appearanceClip = await auditClip(win)
      expect(appearanceClip, 'Appearance section clips Russian labels').toEqual([])

      await win.getByText('Модели', { exact: true }).first().click()
      await win.waitForTimeout(500)
      await win.screenshot({ path: path.join(SHOT_DIR, 'settings-models.png') })
      const modelsClip = await auditClip(win)
      expect(modelsClip, 'Models section clips Russian labels').toEqual([])
    } finally {
      await agent.close()
      model.close()
    }
  })

  test('timeline, composer tools and panels have no clipped Russian text', async () => {
    test.setTimeout(180_000)
    const seen: Seen[] = []
    const model = startScriptedModel(
      (_firstUser: string, toolTexts: string[]) =>
        toolTexts.length === 0 ? { tool: { name: 'bash', args: { command: 'echo hi' } } } : { text: 'Готово' },
      seen,
    )
    const agent = await launchAgentApp(await listen(model), { language: 'ru' })
    const { win } = agent
    try {
      await agent.newSession()
      await agent.send('проверка русской разметки')
      await expect(win.getByText('Готово').first()).toBeVisible({ timeout: 60_000 })
      await expect(win.getByText('команд выполнено: 1').first()).toBeVisible()
      await win.waitForTimeout(1000)
      await win.screenshot({ path: path.join(SHOT_DIR, 'timeline.png') })
      const timelineClip = await auditClip(win)
      expect(timelineClip, 'timeline clips Russian labels').toEqual([])

      // Composer tools menu: capability names, reasons and the cache warming group.
      await win.locator('[data-composer-tools]').click()
      await win.waitForTimeout(700)
      await win.screenshot({ path: path.join(SHOT_DIR, 'composer-tools.png') })
      const toolsClip = await auditClip(win)
      expect(toolsClip, 'composer tools menu clips Russian labels').toEqual([])
      await win.keyboard.press('Escape')

      // Right panels (Run / Context / Review keep their names untranslated).
      const expand = win.locator('button[aria-label="Развернуть правую панель"]')
      if (await expand.count()) await expand.first().click()
      for (const panel of ['Run', 'Context', 'Review']) {
        const tab = win.getByText(panel, { exact: true }).first()
        if ((await tab.count()) === 0) continue
        await tab.click()
        await win.waitForTimeout(800)
        await win.screenshot({ path: path.join(SHOT_DIR, `panel-${panel.toLowerCase()}.png`) })
        const clip = await auditClip(win)
        expect(clip, `${panel} panel clips Russian labels`).toEqual([])
      }
    } finally {
      await agent.close()
      model.close()
    }
  })
})
