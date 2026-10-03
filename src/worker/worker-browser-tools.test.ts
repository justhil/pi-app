import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: Record<string, unknown>[] = []
vi.mock('./worker-transport.js', () => ({ sendToMain: (m: Record<string, unknown>) => sent.push(m) }))

const mod = await import('./worker-browser-tools')
const { BROWSER_TOOL_NAMES, browserToolsExtension, handleBrowserToolResponse, nextActiveTools, setBrowserToolsEnabled } = mod

type Tool = { name: string; execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown> }

function fakePi(initial: string[]) {
  let active = [...initial]
  const tools: Tool[] = []
  const handlers: Record<string, () => void> = {}
  const setActiveTools = vi.fn((next: string[]) => (active = [...next]))
  const pi = {
    registerTool: (t: Tool) => tools.push(t),
    on: (name: string, fn: () => void) => (handlers[name] = fn),
    getActiveTools: () => active,
    setActiveTools,
  }
  return { pi, tools, handlers, setActiveTools, active: () => active }
}

describe('worker browser tools', () => {
  beforeEach(() => {
    sent.length = 0
  })

  it('computes the active set with or without the browser family', () => {
    expect(nextActiveTools(['read', 'browser_tabs', 'bash'], false)).toEqual(['read', 'bash'])
    expect(nextActiveTools(['read'], true)).toEqual(['read', ...BROWSER_TOOL_NAMES])
  })

  it('registers eight tools, hides them on session start, and only rebuilds when the set changes', async () => {
    // pi activates newly registered tools by default.
    const f = fakePi(['read', 'bash', ...BROWSER_TOOL_NAMES])
    const ext = browserToolsExtension as { factory: (pi: unknown) => void }
    setBrowserToolsEnabled(false)
    await ext.factory(f.pi)
    expect(f.tools.map((t) => t.name)).toEqual(BROWSER_TOOL_NAMES)
    f.handlers.session_start()
    expect(f.active()).toEqual(['read', 'bash'])

    f.setActiveTools.mockClear()
    setBrowserToolsEnabled(false)
    expect(f.setActiveTools).not.toHaveBeenCalled()
    setBrowserToolsEnabled(true)
    expect(f.active()).toEqual(['read', 'bash', ...BROWSER_TOOL_NAMES])
    setBrowserToolsEnabled(false)
    expect(f.active()).toEqual(['read', 'bash'])
  })

  it('forwards calls to Main and maps errors to thrown tool errors', async () => {
    const f = fakePi([])
    await (browserToolsExtension as { factory: (pi: unknown) => void }).factory(f.pi)
    const snapshot = f.tools.find((t) => t.name === 'browser_snapshot')!
    const ok = snapshot.execute('t1', { tabId: 'x' })
    const req = sent.at(-1)!
    expect(req).toMatchObject({ type: 'browser-tool-request', tool: 'browser_snapshot', args: { tabId: 'x' } })
    await handleBrowserToolResponse({ type: 'browser-tool-response', callId: req.callId, result: { content: [{ type: 'text', text: 'outline' }] } }, () => {})
    await expect(ok).resolves.toEqual({ content: [{ type: 'text', text: 'outline' }], details: {} })

    const bad = snapshot.execute('t2', {})
    const req2 = sent.at(-1)!
    await handleBrowserToolResponse({ type: 'browser-tool-response', callId: req2.callId, result: { content: [{ type: 'text', text: 'browser_no_tab: open one' }], isError: true } }, () => {})
    await expect(bad).rejects.toThrow('browser_no_tab')
  })
})
