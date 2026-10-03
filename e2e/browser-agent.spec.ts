import { test, expect, _electron as electron } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out/main/index.js')
const shotDir = path.join(root, 'test-results', 'browser-agent')

type Seen = { system: string; tools: string[]; toolResults: number; firstUser: string; toolTexts: string[] }

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

/** Test page: a form whose events report whether they were trusted input. */
function startSite(events: string[]) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/log') {
      let body = ''
      for await (const chunk of req) body += chunk
      events.push(...(JSON.parse(body) as string[]))
      res.end('ok')
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><title>Profile</title><body style="font:16px sans-serif;margin:24px">
      <main><h1>Profile</h1>
        <label for="name">Name</label> <input id="name">
        <button id="save" style="margin-left:8px">Save</button>
        <p id="out"></p>
      </main>
      <script>
        const log = [];
        for (const t of ['mousedown', 'click', 'input']) document.addEventListener(t, (e) => log.push(t + ':' + e.isTrusted), true);
        document.getElementById('save').addEventListener('click', () => {
          document.getElementById('out').textContent = 'Saved ' + document.getElementById('name').value;
          fetch('/log', { method: 'POST', body: JSON.stringify(log) });
        });
      </script></body>`)
  })
  return server
}

const toolText = (m: { content?: unknown }) =>
  typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c: { text?: string }) => c.text ?? '').join('\n') : ''

/** OpenAI-compatible scripted model: drives the browser tools step by step and records requests. */
function startModel(siteBase: string, seen: Seen[]) {
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (!req.url?.includes('/chat/completions')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [] }))
      return
    }
    const request = JSON.parse(body || '{}')
    const messages: { role: string; content?: unknown }[] = request.messages ?? []
    const system = messages.filter((m) => m.role === 'system' || m.role === 'developer').map(toolText).join('\n')
    const firstUser = toolText(messages.find((m) => m.role === 'user') ?? {})
    const toolMessages = messages.filter((m) => m.role === 'tool')
    const tools = (request.tools ?? []).map((t: { function?: { name?: string } }) => t.function?.name ?? '')
    seen.push({ system, tools, toolResults: toolMessages.length, firstUser, toolTexts: toolMessages.map(toolText) })
    const allToolText = toolMessages.map(toolText).join('\n')
    const refFor = (pattern: RegExp) => allToolText.match(pattern)?.[1] ?? 'e0'

    let step: { tool?: { name: string; args: unknown }; text?: string }
    if (!firstUser.includes('BROWSER-TASK')) step = { text: 'plain done' }
    else {
      const script = [
        { tool: { name: 'browser_tabs', args: { action: 'new', url: `${siteBase}/form` } } },
        { tool: { name: 'browser_snapshot', args: {} } },
        { tool: { name: 'browser_act', args: { action: 'fill', ref: refFor(/textbox "Name" \[ref=(e\d+)\]/), value: 'Maya' } } },
        { tool: { name: 'browser_act', args: { action: 'click', ref: refFor(/button "Save" \[ref=(e\d+)\]/) } } },
        { tool: { name: 'browser_wait', args: { text: 'Saved Maya' } } },
        { tool: { name: 'browser_screenshot', args: {} } },
        { text: 'browser done' },
      ]
      step = script[Math.min(toolMessages.length, script.length - 1)]
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (delta: unknown, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    send({ role: 'assistant', content: '' })
    if (step.text) send({ content: step.text })
    if (step.tool) send({ tool_calls: [{ index: 0, id: `call_${toolMessages.length + 1}`, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] })
    send({}, step.tool ? 'tool_calls' : 'stop')
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
  return server
}

test.describe('browser control capability', () => {
  test.setTimeout(180_000)

  test('drives the browser through real tools only while switched on', async () => {
    const events: string[] = []
    const seen: Seen[] = []
    const site = startSite(events)
    const siteBase = `http://127.0.0.1:${await listen(site)}`
    const model = startModel(siteBase, seen)
    const modelPort = await listen(model)

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-agent-'))
    const agentDir = path.join(home, '.pi', 'agent')
    const project = path.join(home, 'code', 'demo')
    // Launched by main entry (not the app dir), Electron names userData after itself.
    const configDir = path.join(home, '.config', 'Electron')
    fs.mkdirSync(agentDir, { recursive: true })
    fs.mkdirSync(project, { recursive: true })
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(project, 'README.md'), '# demo\n')
    fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          api: 'openai-completions',
          apiKey: 'test-key',
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text', 'image'], contextWindow: 200000, maxTokens: 8000 }],
        },
      },
    }))
    fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'mock', defaultModel: 'scripted', defaultThinkingLevel: 'off' }))
    fs.writeFileSync(path.join(configDir, 'pi-desktop.json'), JSON.stringify({
      language: 'en',
      currentProject: project,
      recentProjects: [project],
      windowBounds: { width: 1400, height: 900 },
      rightPanelPrefs: { files: true, run: true, browser: true },
    }))
    fs.mkdirSync(shotDir, { recursive: true })

    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry, '--ozone-platform=x11', '--lang=en-US', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        PI_CODING_AGENT_DIR: agentDir,
        PI_E2E: '1',
        LANG: 'en_US.UTF-8',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
      timeout: 60_000,
    })
    try {
      const win = await app.firstWindow({ timeout: 45_000 })
      await win.waitForFunction(() => !!(window as unknown as { __piE2E?: unknown }).__piE2E, null, { timeout: 45_000 })
      await win.waitForTimeout(2500)

      const newSession = async () => {
        await win.locator('button[aria-label="New session"]').first().click()
        await win.waitForTimeout(1200)
      }
      const send = async (message: string) => {
        const editor = win.locator('[contenteditable="true"]').last()
        await editor.click()
        await win.keyboard.type(message)
        await win.keyboard.press('Enter')
      }

      // Session 1: switch browser control on, then ask.
      await newSession()
      await win.locator('[data-composer-tools]').click()
      const toggle = win.getByRole('switch', { name: 'Browser control' })
      await expect(toggle).toBeEnabled()
      await toggle.click()
      await win.keyboard.press('Escape')
      await expect(win.locator('.composer-capability-chip')).toHaveCount(1)
      await send('BROWSER-TASK fill the profile form')
      await win.waitForTimeout(1500)

      await expect.poll(() => seen.filter((s) => s.firstUser.includes('BROWSER-TASK')).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(7)
      await expect(win.getByText('browser done')).toBeVisible({ timeout: 30_000 })
      await win.screenshot({ path: path.join(shotDir, 'timeline.png') })

      const browserTurns = seen.filter((s) => s.firstUser.includes('BROWSER-TASK'))
      expect(browserTurns[0].tools).toEqual(expect.arrayContaining(['browser_tabs', 'browser_snapshot', 'browser_act', 'browser_screenshot']))
      expect(browserTurns[0].system).toContain('# Built-in browser')
      // Every tool call succeeded: no error codes came back, and the outline carried the refs.
      const results = browserTurns.at(-1)!.toolTexts
      expect(results.filter((r) => /browser_(denied|timeout|stale_ref|no_tab|disabled|dialog_pending|error)/.test(r))).toEqual([])
      expect(results[1]).toMatch(/textbox "Name" \[ref=e\d+\]/)
      expect(results[1]).toMatch(/button "Save" \[ref=e\d+\]/)
      // The page received real (trusted) input from the agent.
      await expect.poll(() => events.length, { timeout: 10_000 }).toBeGreaterThan(0)
      expect(events).toContain('click:true')
      expect(events).toContain('input:true')
      expect(events.filter((e) => e.endsWith(':false'))).toEqual([])

      // Session 2: a new session starts with every capability off.
      await newSession()
      await expect(win.locator('.composer-capability-chip')).toHaveCount(0)
      await send('PLAIN-TASK hello')
      await expect.poll(() => seen.some((s) => s.firstUser.includes('PLAIN-TASK')), { timeout: 60_000 }).toBe(true)
      const plain = seen.find((s) => s.firstUser.includes('PLAIN-TASK'))!
      expect(plain.tools.filter((t) => t.startsWith('browser_'))).toEqual([])
      expect(plain.system).not.toContain('Built-in browser')
      expect(plain.system).not.toContain('browser_')
    } finally {
      await app.close()
      site.close()
      model.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
