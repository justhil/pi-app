import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

test.describe('model routing', () => {
  test('a router built on the settings page routes requests and switches after the first edit', async () => {
    test.setTimeout(150_000)
    const seen: Seen[] = []
    const model = startScriptedModel(
      (_first, tools) => (tools.length === 0 ? { tool: { name: 'write', args: { path: 'notes.txt', content: 'hi' } } } : { text: 'routed done' }),
      seen,
    )
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    const agentDir = path.join(agent.home, '.pi', 'agent')
    try {
      // a second physical model on the same mock endpoint
      const modelsFile = path.join(agentDir, 'models.json')
      const config = JSON.parse(fs.readFileSync(modelsFile, 'utf8'))
      config.providers.mock.models.push({ id: 'big', name: 'Big', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 8000 })
      fs.writeFileSync(modelsFile, JSON.stringify(config))

      await agent.newSession()
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('Model routing', { exact: true }).first().click()
      await win.getByRole('button', { name: 'New router' }).click()
      const canvas = win.locator('[data-routing-canvas]')
      await canvas.getByLabel('Classifier', { exact: true }).fill('')
      await canvas.getByLabel('fallback model').fill('mock/big')
      await canvas.locator('[data-route-node="after-edit"]').getByRole('switch').click()
      await canvas.getByLabel('After the first edit model').fill('mock/scripted')
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-routing.png') })
      await win.getByRole('button', { name: 'Save', exact: true }).first().click()
      await expect(win.getByText('Saved. Running sessions')).toBeVisible()

      const saved = JSON.parse(fs.readFileSync(path.join(agentDir, 'pi-desktop-routers.json'), 'utf8'))
      expect(saved.routers[0]).toMatchObject({ id: 'auto', classifier: '', fallback: { model: 'mock/big' }, afterEdit: { model: 'mock/scripted' } })

      // pick the virtual model for new sessions, then start one
      const settingsFile = path.join(agentDir, 'settings.json')
      fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), defaultProvider: 'router', defaultModel: 'auto' }))
      await win.getByRole('button', { name: /Back/ }).first().click()
      await agent.newSession()
      await agent.send('ROUTE make a note')
      await expect(win.getByText('routed done')).toBeVisible({ timeout: 60_000 })
      const turns = seen.filter((s) => s.firstUser.includes('ROUTE'))
      expect(turns.map((s) => s.model)).toEqual(['big', 'scripted'])
      expect(fs.readFileSync(path.join(agent.project, 'notes.txt'), 'utf8')).toBe('hi')
    } finally {
      await agent.close()
      model.close()
    }
  })
})
