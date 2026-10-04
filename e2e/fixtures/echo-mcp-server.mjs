// Minimal stdio MCP server for e2e: one `echo` tool. Newline-delimited JSON-RPC, no dependencies.
import { createInterface } from 'node:readline'

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
const tools = [
  {
    name: 'echo',
    description: 'Echo the given text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
]

createInterface({ input: process.stdin }).on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.id === undefined) return
  switch (req.method) {
    case 'initialize':
      return send({
        id: req.id,
        result: { protocolVersion: req.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } },
      })
    case 'tools/list':
      return send({ id: req.id, result: { tools } })
    case 'tools/call':
      return send({ id: req.id, result: { content: [{ type: 'text', text: `echo: ${req.params?.arguments?.text ?? ''}` }] } })
    case 'ping':
      return send({ id: req.id, result: {} })
    default:
      return send({ id: req.id, error: { code: -32601, message: `unknown method ${req.method}` } })
  }
})
