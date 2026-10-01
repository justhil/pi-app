// Seed an isolated demo HOME: a small git repo plus pi sessions written through the real SDK.
// Tool results come from actually running the SDK's read/edit/bash tools on the demo repo.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MODEL, PROJECT_FILES, fixTurnSteps, text } from './demo-script.mjs'

/**
 * @param {{ root: string, lang: 'zh' | 'en', live?: boolean, mockPort: number }} options
 *   live: leave the fix session out so a real worker can run it during recording.
 * @returns {Promise<{ home: string, agentDir: string, project: string }>}
 */
export async function seedDemo({ root, lang, live = false, mockPort }) {
  const home = join(root, 'home')
  const agentDir = join(home, '.pi', 'agent')
  const project = join(home, 'code', 'lumen')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(agentDir, { recursive: true })

  for (const [name, content] of Object.entries(PROJECT_FILES)) {
    mkdirSync(dirname(join(project, name)), { recursive: true })
    writeFileSync(join(project, name), content)
  }
  const gitEnv = { ...process.env, GIT_AUTHOR_DATE: '2026-09-28T10:00:00', GIT_COMMITTER_DATE: '2026-09-28T10:00:00' }
  const git = (...args) => execFileSync('git', args, { cwd: project, stdio: 'pipe', env: gitEnv })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'dev@lumen.local')
  git('config', 'user.name', 'lumen dev')
  git('add', '.')
  git('commit', '-q', '-m', 'feat: initial link parser')

  // The provider points at the local scripted endpoint; it is only called during live recording.
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      [MODEL.provider]: {
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        api: MODEL.api,
        apiKey: 'demo-key',
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{ id: MODEL.id, name: MODEL.name, reasoning: true, input: ['text', 'image'], contextWindow: 200000, maxTokens: 64000 }],
      },
    },
  }, null, 2))
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: MODEL.provider, defaultModel: MODEL.id, defaultThinkingLevel: 'medium' }, null, 2))

  // The SDK resolves its agent dir from the environment at call time.
  const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR }
  process.env.HOME = home
  process.env.PI_CODING_AGENT_DIR = agentDir
  try {
    await writeSessions({ project, lang, live })
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  return { home, agentDir, project }
}

async function writeSessions({ project, lang, live }) {
  const { SessionManager, createReadTool, createEditTool, createBashTool } = await import('@earendil-works/pi-coding-agent')
  const tools = { read: createReadTool(project), edit: createEditTool(project), bash: createBashTool(project) }
  const t = text(lang)
  const meta = { api: MODEL.api, provider: MODEL.provider, model: MODEL.id }
  let clock = Date.parse('2026-09-30T09:12:00Z')
  const tick = (seconds) => (clock += seconds * 1000)
  const usage = (input, output) => ({ input, output, cacheRead: Math.round(input * 0.7), cacheWrite: 0, reasoning: 0, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
  let callSeq = 0

  const session = (title) => {
    const sm = SessionManager.create(project)
    sm.appendModelChange(MODEL.provider, MODEL.id)
    sm.appendThinkingLevelChange('medium')
    sm.appendSessionInfo(title)
    return sm
  }
  const user = (sm, body) => sm.appendMessage({ role: 'user', content: [{ type: 'text', text: body }], timestamp: tick(20) })
  const reply = (sm, body, thinking) => sm.appendMessage({
    role: 'assistant', ...meta, stopReason: 'stop', usage: usage(9800, 420), timestamp: tick(6),
    content: [...(thinking ? [{ type: 'thinking', thinking }] : []), { type: 'text', text: body }],
  })
  const toolStep = async (sm, { thinking, tool }) => {
    const id = `toolu_demo_${++callSeq}`
    sm.appendMessage({
      role: 'assistant', ...meta, stopReason: 'toolUse', usage: usage(8600, 160), timestamp: tick(4),
      content: [...(thinking ? [{ type: 'thinking', thinking }] : []), { type: 'toolCall', id, name: tool.name, arguments: tool.args }],
    })
    const result = await tools[tool.name].execute(id, tool.args)
    sm.appendMessage({ role: 'toolResult', toolCallId: id, toolName: tool.name, content: result.content, details: result.details, isError: false, timestamp: tick(2) })
  }

  const json = session(t.jsonTitle)
  user(json, t.jsonPrompt)
  await toolStep(json, { tool: { name: 'read', args: { path: 'src/cli.mjs' } } })
  reply(json, t.jsonReply)

  if (!live) {
    tick(3600)
    const fix = session(t.fixTitle)
    user(fix, t.fixPrompt)
    for (const step of fixTurnSteps(lang)) {
      if (step.tool) await toolStep(fix, step)
      else reply(fix, step.text, step.thinking)
    }
  }

  tick(600)
  const plan = session(t.planTitle)
  user(plan, t.planPrompt)
  reply(plan, t.planReply)
}
