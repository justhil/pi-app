import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: Record<string, unknown>[] = []
vi.mock('./worker-transport.js', () => ({ sendToMain: (m: Record<string, unknown>) => sent.push(m) }))

const mod = await import('./worker-browser-tools')
const { BROWSER_TOOL_NAMES, browserToolsExtension, handleBrowserToolResponse, nextActiveTools, setBrowserToolsEnabled } = mod
const { BROWSER_CORE_TOOLS } = await import('@shared/browser-tools')

type Tool = { name: string; exposure?: string; execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown> }

/** Fake pi: re-registering a name replaces the tool (as pi does). `withSearch` registers tool_search. */
function fakePi(initial: string[], withSearch = false) {
  let active = [...initial]
  const byName = new Map<string, Tool>()
  const handlers: Record<string, (event?: unknown, ctx?: unknown) => void> = {}
  const setActiveTools = vi.fn((next: string[]) => (active = [...next]))
  const pi = {
    registerTool: (t: Tool) => byName.set(t.name, t),
    on: (name: string, fn: (event?: unknown, ctx?: unknown) => void) => (handlers[name] = fn),
    getActiveTools: () => active,
    getAllTools: () => [...(withSearch ? [{ name: 'tool_search' }] : []), ...byName.values()],
    setActiveTools,
  }
  return { pi, tools: () => [...byName.values()], tool: (n: string) => byName.get(n)!, handlers, setActiveTools, active: () => active }
}

describe('worker browser tools', () => {
  beforeEach(() => {
    sent.length = 0
  })

  it('computes the active set with or without the browser family', () => {
    expect(nextActiveTools(['read', 'browser_tabs', 'bash'], false)).toEqual(['read', 'bash'])
    expect(nextActiveTools(['read'], true)).toEqual(['read', ...BROWSER_TOOL_NAMES])
  })

  it('declares only core tools plus tool_search when deferral is available, and hides the rest when off', async () => {
    const f = fakePi(['read', 'bash'], true)
    setBrowserToolsEnabled(false)
    await (browserToolsExtension as { factory: (pi: unknown) => void }).factory(f.pi)
    f.handlers.session_start()
    expect(f.active()).toEqual(['read', 'bash'])
    expect(f.tool('browser_tabs').exposure).toBe('hidden')
    expect(f.tool('browser_navigate').exposure).toBeUndefined()

    setBrowserToolsEnabled(true)
    expect(f.active()).toEqual(['read', 'bash', 'tool_search', ...BROWSER_CORE_TOOLS])
    expect(f.tool('browser_tabs').exposure).toBe('deferred')

    // tool_search loaded browser_tabs; the next switch keeps it
    f.pi.setActiveTools([...f.active(), 'browser_tabs'])
    setBrowserToolsEnabled(true)
    expect(f.active()).toContain('browser_tabs')

    setBrowserToolsEnabled(false)
    expect(f.active()).toEqual(['read', 'bash'])
    expect(f.tool('browser_tabs').exposure).toBe('hidden')
    await expect(f.tool('browser_navigate').execute('x', {})).rejects.toThrow('browser_off')
  })

  it('keeps declared tools when switched off on models that take mid-conversation tool additions', async () => {
    const f = fakePi(['read'], true)
    setBrowserToolsEnabled(false)
    await (browserToolsExtension as { factory: (pi: unknown) => void }).factory(f.pi)
    f.handlers.session_start({}, { model: { compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true } } })
    setBrowserToolsEnabled(true)
    const on = f.active()
    f.setActiveTools.mockClear()
    setBrowserToolsEnabled(false)
    expect(f.setActiveTools).not.toHaveBeenCalled()
    expect(f.active()).toEqual(on)
    await expect(f.tool('browser_click').execute('x', {})).rejects.toThrow('browser_off')
    // a model without that support gets the tools removed
    f.handlers.model_select({}, { model: { compat: {} } })
    setBrowserToolsEnabled(false)
    expect(f.active()).toEqual(['read'])
  })

  it('keeps a tool_search the user enabled when browser control switches off', async () => {
    const f = fakePi(['read', 'tool_search'], true)
    setBrowserToolsEnabled(false)
    await (browserToolsExtension as { factory: (pi: unknown) => void }).factory(f.pi)
    f.handlers.session_start()
    setBrowserToolsEnabled(true)
    expect(f.active()).toEqual(['read', 'tool_search', ...BROWSER_CORE_TOOLS])
    setBrowserToolsEnabled(false)
    expect(f.active()).toEqual(['read', 'tool_search'])
  })

  it('declares every tool on runtimes without tool_search, and only rebuilds when the set changes', async () => {
    const f = fakePi(['read', 'bash'])
    const ext = browserToolsExtension as { factory: (pi: unknown) => void }
    setBrowserToolsEnabled(false)
    await ext.factory(f.pi)
    expect(f.tools().map((t) => t.name)).toEqual(BROWSER_TOOL_NAMES)
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
    setBrowserToolsEnabled(true)
    const snapshot = f.tool('browser_snapshot')
    const ok = snapshot.execute('t1', { depth: 3 })
    const req = sent.at(-1)!
    expect(req).toMatchObject({ type: 'browser-tool-request', tool: 'browser_snapshot', args: { depth: 3 } })
    await handleBrowserToolResponse({ type: 'browser-tool-response', callId: req.callId, result: { content: [{ type: 'text', text: 'outline' }] } }, () => {})
    await expect(ok).resolves.toEqual({ content: [{ type: 'text', text: 'outline' }], details: {} })

    const bad = snapshot.execute('t2', {})
    const req2 = sent.at(-1)!
    await handleBrowserToolResponse({ type: 'browser-tool-response', callId: req2.callId, result: { content: [{ type: 'text', text: 'browser_no_tab: open one' }], isError: true } }, () => {})
    await expect(bad).rejects.toThrow('browser_no_tab')
  })
})
