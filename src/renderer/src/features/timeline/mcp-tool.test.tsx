import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { ToolCallRow } from './tool-call-row'
import { displayToolName, formatMcpOutput, mcpArgSummary, resolveMcpTool } from './mcp-tool'

afterEach(() => cleanup())

beforeEach(() => {
  useUIStore.setState({
    historySessionFile: '/workspace/session.jsonl',
    runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    toolExpandBySession: {},
  })
})

describe('resolveMcpTool', () => {
  it('prefers the server and tool from the result details over the sanitized name', () => {
    expect(resolveMcpTool('mcp__my_server__get_doc', { server: 'my-server', tool: 'get.doc' })).toEqual({
      server: 'my-server',
      tool: 'get.doc',
    })
  })

  it('falls back to the tool name when details are missing (resumed session)', () => {
    expect(resolveMcpTool('mcp__github__search_issues')).toEqual({ server: 'github', tool: 'search_issues' })
  })

  it('reads the server of resource tools from the arguments', () => {
    expect(resolveMcpTool('read_mcp_resource', undefined, { server: 'docs', uri: 'file:///a' })).toEqual({
      server: 'docs',
      tool: 'read_mcp_resource',
    })
  })

  it('ignores other tools', () => {
    expect(resolveMcpTool('bash')).toBeNull()
    expect(displayToolName('bash')).toBe('bash')
    expect(displayToolName('mcp__github__search_issues')).toBe('github/search_issues')
  })
})

describe('mcpArgSummary / formatMcpOutput', () => {
  it('uses a well-known key first, else key=value pairs', () => {
    expect(mcpArgSummary({ owner: 'a', query: 'is:open bug' })).toBe('is:open bug')
    expect(mcpArgSummary({ owner: 'a', repo: 'b', limit: 5, nested: { x: 1 } })).toBe('owner=a repo=b limit=5')
    expect(mcpArgSummary({})).toBe('')
  })

  it('pretty-prints JSON output only', () => {
    expect(formatMcpOutput('{"a":1}')).toEqual({ code: '{\n  "a": 1\n}', lang: 'json' })
    expect(formatMcpOutput('plain text')).toEqual({ code: 'plain text' })
    expect(formatMcpOutput('{not json')).toEqual({ code: '{not json' })
  })
})

describe('ToolCallRow for MCP tools', () => {
  it('labels the call server/tool with its arguments and shows args and output when expanded', () => {
    render(
      <ToolCallRow
        item={{
          id: 'mcp-1',
          type: 'tool-call',
          toolName: 'mcp__github__search_issues',
          toolArgs: { query: 'label:bug' },
          toolOutput: JSON.stringify({ content: [{ type: 'text', text: '{"total":2}' }] }),
          toolDetails: { server: 'github', tool: 'search_issues' },
          toolPhase: 'end',
          timestamp: 1,
        }}
      />,
    )
    const row = screen.getByRole('button', { name: 'github/search_issues · label:bug' })
    expect(row).not.toHaveTextContent('mcp__')
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(document.body.textContent).toContain('"total": 2')
    expect(document.body.textContent).toContain('"query": "label:bug"')
  })
})
