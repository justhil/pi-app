// OpenAI-compatible streaming endpoint that replays the demo turn, so a real pi worker can run a
// real turn offline. The step is chosen by how many tool results the request already contains.
import { createServer } from 'node:http'
import { fixTurnSteps, remoteTurnSteps, text } from './demo-script.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {{ port: number, lang: 'zh' | 'en', pace?: number }} options  pace > 1 slows streaming down
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export function startMockLlm({ port, lang, pace = 1 }) {
  const scripts = { fix: fixTurnSteps(lang), remote: remoteTurnSteps(lang) }
  const remotePrompt = text(lang).remotePrompt
  const piece = lang === 'zh' ? /[\s\S]{1,3}/g : /\S+\s*|\s+/g
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [] }))
      return
    }
    const request = JSON.parse(body || '{}')
    const model = request.model || 'demo'
    const messages = request.messages || []
    const firstUser = messages.find((message) => message.role === 'user')
    const firstText = typeof firstUser?.content === 'string' ? firstUser.content : JSON.stringify(firstUser?.content ?? '')
    const steps = firstText.includes(remotePrompt.slice(0, 12)) ? scripts.remote : scripts.fix
    const toolResults = messages.filter((message) => message.role === 'tool').length
    const step = steps[Math.min(toolResults, steps.length - 1)]
    const send = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-demo', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    const stream = async (key, value, ms) => {
      for (const chunk of value.match(piece) || []) {
        send({ [key]: chunk })
        await sleep(ms * pace)
      }
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    await sleep(450 * pace)
    send({ role: 'assistant', content: '' })
    if (step.thinking) await stream('reasoning_content', step.thinking, 45)
    if (step.text) await stream('content', step.text, 38)
    if (step.tool) {
      const id = `call_demo_${toolResults + 1}`
      const args = JSON.stringify(step.tool.args)
      send({ tool_calls: [{ index: 0, id, type: 'function', function: { name: step.tool.name, arguments: '' } }] })
      for (let i = 0; i < args.length; i += 24) {
        send({ tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 24) } }] })
        await sleep(18)
      }
    }
    send({}, step.tool ? 'tool_calls' : 'stop')
    res.write(`data: ${JSON.stringify({ id: 'chatcmpl-demo', object: 'chat.completion.chunk', created: 0, model, choices: [], usage: { prompt_tokens: 18400 + toolResults * 900, completion_tokens: 380, total_tokens: 18780 + toolResults * 900 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({ close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections() }) }))
  })
}
