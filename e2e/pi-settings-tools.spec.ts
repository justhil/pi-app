import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

test.describe('pi settings · tools', () => {
  test('built-in tools, codemode and tool search save to settings.json', async () => {
    test.setTimeout(90_000)
    const seen: Seen[] = []
    const model = startScriptedModel(() => ({ text: 'ok' }), seen)
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      await agent.newSession()
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Runtime', { exact: true }).first().click()
      const section = win.getByText('Built-in tools', { exact: true }).first()
      await section.scrollIntoViewIfNeeded()
      const row = (label: string) => win.getByRole('group', { name: label, exact: true })

      await expect(win.locator('label:has-text("bash") input[type=checkbox]')).toBeChecked()
      await win.locator('label:has-text("bash") input[type=checkbox]').uncheck()
      await win.locator('label:has-text("grep") input[type=checkbox]').check()
      await row('Codemode').getByRole('switch').click()
      await row('Tool search').getByRole('switch').click()
      await win.getByText('Tools', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await win.screenshot({ path: process.env.SHOT ?? path.join(agent.home, 'tools.png') })
      await win.getByRole('button', { name: 'Save', exact: true }).click()

      const file = path.join(agent.home, '.pi', 'agent', 'settings.json')
      await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).defaultTools, { timeout: 10_000 }).toEqual([
        '-bash',
        '+grep',
        '+codemode',
        '+tool_search',
      ])
    } finally {
      await agent.close()
      model.close()
    }
  })

  test('composer tools menu switches cache warming', async () => {
    test.setTimeout(90_000)
    const model = startScriptedModel(() => ({ text: 'ok' }), [])
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      await agent.newSession()
      await win.locator('[data-composer-tools]').click()
      const row = win.locator('[data-cache-warming]')
      await expect(row).toHaveAttribute('data-cache-warming', 'streaming')
      await row.getByRole('radio', { name: 'Also idle' }).click()
      await expect(row).toHaveAttribute('data-cache-warming', 'idle')
      await expect(row.getByRole('radio', { name: 'Also idle' })).toHaveAttribute('aria-checked', 'true')
      await win.waitForTimeout(300)
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-cache.png') })
      const file = path.join(agent.home, '.pi', 'agent', 'settings.json')
      await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).cacheWarming, { timeout: 10_000 }).toBe('idle')
      await win.keyboard.press('Escape')
      await win.locator('[data-composer-tools]').click()
      await expect(win.locator('[data-cache-warming]')).toHaveAttribute('data-cache-warming', 'idle')
    } finally {
      await agent.close()
      model.close()
    }
  })

  test('thinking budgets and per-model compaction save to settings.json', async () => {
    test.setTimeout(90_000)
    const model = startScriptedModel(() => ({ text: 'ok' }), [])
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      await agent.newSession()
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Runtime', { exact: true }).first().click()
      await win.getByLabel('thinkingBudgets.low').fill('2048')
      await win.getByLabel('thinkingBudgets.low').blur()
      await win.locator('[data-compaction-overrides]').getByRole('button', { name: 'Add model' }).click()
      const reserve = win.getByLabel(/reserveTokens$/).first()
      await reserve.fill('400000')
      await reserve.blur()
      if (process.env.SHOT) {
        await win.locator('[data-compaction-overrides]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await win.screenshot({ path: process.env.SHOT.replace('.png', '-compaction.png') })
      }
      await win.getByRole('button', { name: 'Save', exact: true }).click()
      const file = path.join(agent.home, '.pi', 'agent', 'settings.json')
      await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).thinkingBudgets, { timeout: 10_000 }).toEqual({ low: 2048 })
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).compaction.modelOverrides).toEqual({ 'mock/scripted': { reserveTokens: 400000 } })
    } finally {
      await agent.close()
      model.close()
    }
  })

  test('model entry advanced fields save to models.json', async () => {
    test.setTimeout(90_000)
    const model = startScriptedModel(() => ({ text: 'ok' }), [])
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    try {
      await agent.newSession()
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Models', { exact: true }).first().click()
      await win.getByText('scripted', { exact: true }).first().click()
      await win.locator('[data-model-advanced] > button').click()
      const fill = async (label: string, v: string) => {
        await win.getByLabel(label, { exact: true }).fill(v)
        await win.getByLabel(label, { exact: true }).blur()
      }
      await fill('samplingParams.temperature', '0.7')
      await fill('samplingParamsByThinkingLevel.off.top_p', '0.8')
      await fill('inputLimits.images.resize.maxWidth', '1568')
      await fill('promptCache.short', '300')
      await fill('cost.input', '3')
      await fill('cost.output', '15')
      await win.getByLabel('compat.supportsMidConvoSystemMessages').check()
      await win.getByLabel('compat.supportsMidConvoToolAdditions').check()
      if (process.env.SHOT) {
        await win.locator('[data-model-advanced]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await win.screenshot({ path: process.env.SHOT.replace('.png', '-advanced.png') })
      }
      await win.getByRole('button', { name: 'Save', exact: true }).click()
      const file = path.join(agent.home, '.pi', 'agent', 'models.json')
      await expect
        .poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).providers.mock.models[0].promptCache, { timeout: 10_000 })
        .toEqual({ short: 300 })
      const entry = JSON.parse(fs.readFileSync(file, 'utf8')).providers.mock.models[0]
      expect(entry.samplingParams).toEqual({ temperature: 0.7 })
      expect(entry.samplingParamsByThinkingLevel).toEqual({ off: { top_p: 0.8 } })
      expect(entry.inputLimits).toEqual({ images: { resize: { maxWidth: 1568 } } })
      expect(entry.contextWindow).toBe(200000)
      expect(entry.cost).toEqual({ input: 3, output: 15, cacheRead: 0, cacheWrite: 0 })
      expect(entry.compat).toEqual({ supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true })
    } finally {
      await agent.close()
      model.close()
    }
  })
})
