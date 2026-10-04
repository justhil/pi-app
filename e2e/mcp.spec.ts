import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchAgentApp, listen, startScriptedModel, type Seen } from './helpers/scripted-agent'

const echoServer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'echo-mcp-server.mjs')

function writeAgentFiles(home: string, settings: Record<string, unknown>, servers: Record<string, unknown>) {
  const agentDir = path.join(home, '.pi', 'agent')
  const file = path.join(agentDir, 'settings.json')
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...settings }))
  fs.writeFileSync(path.join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: servers }))
}

test.describe('MCP and codemode', () => {
  test('sessions load codemode and MCP servers from settings and mcp.json', async () => {
    test.setTimeout(120_000)
    const seen: Seen[] = []
    const model = startScriptedModel(() => ({ text: 'done' }), seen)
    const agent = await launchAgentApp(await listen(model))
    try {
      writeAgentFiles(agent.home, { defaultTools: ['+codemode'] }, { echo: { command: process.execPath, args: [echoServer], exposure: 'direct' } })
      await agent.newSession()
      await agent.send('hello')
      await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThan(0)
      expect(seen[0].tools).toContain('codemode')
      expect(seen[0].tools).toContain('mcp__echo__echo')
      expect(seen[0].tools).toContain('bash')
    } finally {
      await agent.close()
      model.close()
    }
  })

  test('settings page manages servers in mcp.json', async () => {
    test.setTimeout(150_000)
    const model = startScriptedModel(() => ({ text: 'ok' }), [])
    const agent = await launchAgentApp(await listen(model))
    const { win } = agent
    const file = path.join(agent.home, '.pi', 'agent', 'mcp.json')
    const servers = () => JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers
    try {
      writeAgentFiles(agent.home, {}, { echo: { command: process.execPath, args: [echoServer] }, broken: { command: '/nonexistent-mcp-bin' } })
      await agent.newSession()
      await win.locator('button:has-text("Settings")').first().click()
      await win.getByText('MCP', { exact: true }).first().click()

      const echo = win.locator('[data-mcp-server="echo"]')
      await expect(echo).toHaveAttribute('data-state', 'connected', { timeout: 60_000 })
      await expect(echo).toContainText('1 tool')
      await expect(win.locator('[data-mcp-server="broken"]')).toHaveAttribute('data-state', 'failed')
      await expect(win.locator('[data-mcp-server="broken"]')).toContainText('ENOENT')

      // add a server through the form
      await win.getByRole('button', { name: 'Add server' }).click()
      const editor = win.locator('[data-mcp-editor]')
      await editor.getByLabel('Name').fill('echo2')
      await editor.getByLabel('Command', { exact: true }).fill(process.execPath)
      await editor.getByLabel('Arguments (one per line)').fill(echoServer)
      await editor.getByRole('button', { name: 'Save' }).click()
      await expect.poll(() => servers().echo2).toEqual({ command: process.execPath, args: [echoServer] })

      // exposure and enabled write back to the file
      await echo.getByLabel('Exposure').selectOption('deferred')
      await expect.poll(() => servers().echo.exposure).toBe('deferred')
      await win.locator('[data-mcp-server="echo2"]').getByRole('switch').click()
      await expect.poll(() => servers().echo2.enabled).toBe(false)
      await expect(win.locator('[data-mcp-server="echo2"]')).toHaveAttribute('data-state', 'disabled')
      if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-mcp.png') })

      // import from another client's format
      await win.getByRole('button', { name: 'Import', exact: true }).click()
      await win.getByLabel('Import from another client').fill(JSON.stringify({ servers: { docs: { type: 'http', url: 'https://docs.test/mcp' } } }))
      await win.getByRole('button', { name: 'Import', exact: true }).last().click()
      await expect.poll(() => servers().docs).toEqual({ url: 'https://docs.test/mcp' })
      await expect(win.locator('[data-mcp-server="docs"]')).toBeVisible()

      // remove
      win.once('dialog', (d) => void d.accept())
      await win.locator('[data-mcp-server="echo2"]').getByRole('button', { name: 'Remove' }).click()
      await expect.poll(() => servers().echo2).toBeUndefined()
    } finally {
      await agent.close()
      model.close()
    }
  })
})
