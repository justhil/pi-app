import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainEntry = path.join(root, 'out/main/index.js')

/** One request the scripted model received. */
export type Seen = { system: string; tools: string[]; toolResults: number; firstUser: string; toolTexts: string[] }
export type Step = { tool?: { name: string; args: unknown }; text?: string; /** Hold the reply this long (to observe the running state). */ delayMs?: number }
/** Next step given the user's first message and the tool results so far (oldest first). */
export type Script = (firstUser: string, toolTexts: string[], lastUser: string) => Step

export function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

const contentText = (m: { content?: unknown }) =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((c: { text?: string; type?: string }) => c.text ?? (c.type === 'image_url' ? '[image]' : '')).join('\n')
      : ''

/** OpenAI-compatible model that follows `script` and records every request. */
export function startScriptedModel(script: Script, seen: Seen[]): http.Server {
  return http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (!req.url?.includes('/chat/completions')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [] }))
      return
    }
    const request = JSON.parse(body || '{}')
    const messages: { role: string; content?: unknown }[] = request.messages ?? []
    const system = messages.filter((m) => m.role === 'system' || m.role === 'developer').map(contentText).join('\n')
    const firstUser = contentText(messages.find((m) => m.role === 'user') ?? {})
    const toolTexts = messages.filter((m) => m.role === 'tool').map(contentText)
    const tools = (request.tools ?? []).map((t: { function?: { name?: string } }) => t.function?.name ?? '')
    seen.push({ system, tools, toolResults: toolTexts.length, firstUser, toolTexts })
    const lastUser = contentText([...messages].reverse().find((m) => m.role === 'user') ?? {})
    const step = script(firstUser, toolTexts, lastUser)

    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs))
    const send = (delta: unknown, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    send({ role: 'assistant', content: '' })
    if (step.text) send({ content: step.text })
    if (step.tool) send({ tool_calls: [{ index: 0, id: `call_${toolTexts.length + 1}`, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] })
    send({}, step.tool ? 'tool_calls' : 'stop')
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
}

export interface AgentApp {
  app: ElectronApplication
  win: Page
  home: string
  project: string
  newSession(): Promise<void>
  enableBrowserControl(): Promise<void>
  send(message: string): Promise<void>
  close(): Promise<void>
}

/** Launch pi Desktop against the scripted model with the Browser panel enabled. */
export async function launchAgentApp(modelPort: number, opts: { language?: 'en' | 'zh'; home?: string; keepHome?: boolean; config?: Record<string, unknown> } = {}): Promise<AgentApp> {
  const home = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pi-e2e-agent-'))
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
    language: opts.language ?? 'en',
    currentProject: project,
    recentProjects: [project],
    windowBounds: { width: 1400, height: 900 },
    rightPanelPrefs: { files: true, run: true, browser: true },
    ...opts.config,
  }))

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
  const win = await app.firstWindow({ timeout: 45_000 })
  await win.waitForFunction(() => !!(window as unknown as { __piE2E?: unknown }).__piE2E, null, { timeout: 45_000 })
  await win.waitForTimeout(2500)

  return {
    app,
    win,
    home,
    project,
    async newSession() {
      await win.locator('button[aria-label="New session"], button[aria-label="新建会话"], button[aria-label="新会话"]').first().click()
      await win.waitForTimeout(1200)
    },
    async enableBrowserControl() {
      await win.locator('[data-composer-tools]').click()
      const toggle = win.getByRole('switch', { name: /Browser control|浏览器操控/ })
      await toggle.waitFor({ state: 'visible' })
      await toggle.click()
      await win.keyboard.press('Escape')
    },
    async send(message: string) {
      const editor = win.locator('[contenteditable="true"]').last()
      await editor.click()
      await win.keyboard.type(message)
      await win.keyboard.press('Enter')
    },
    async close() {
      await app.close()
      if (!opts.keepHome) fs.rmSync(home, { recursive: true, force: true })
    },
  }
}

/** First `[ref=eN]` on a snapshot line matching `line`, searching the newest results first. */
export function refIn(texts: string[], line: RegExp): string {
  for (const t of [...texts].reverse()) {
    const hit = t.split('\n').find((l) => line.test(l))?.match(/\[ref=(e\d+)\]/)
    if (hit) return hit[1]
  }
  return 'e0'
}
