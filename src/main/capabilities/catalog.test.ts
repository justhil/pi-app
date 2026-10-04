import { describe, expect, it, vi } from 'vitest'

vi.mock('./pi-ui.md?raw', () => ({ default: '<!-- source note -->\n# pi-ui blocks\n\nUse blocks.' }))
const prefs: { browser?: boolean } = {}

const { capabilityCatalog, capabilitySectionMap, capabilitySections, capabilityToolFamilies, configureCapabilities } = await import('./catalog')
let defer = false
configureCapabilities({ browserPanelEnabled: () => !!prefs.browser, deferTools: () => defer })

describe('capability catalog', () => {
  it('yields nothing when no capability is on', () => {
    expect(capabilitySections([])).toEqual([])
    expect(capabilitySections(undefined)).toEqual([])
    expect(capabilitySections(['nope'])).toEqual([])
  })

  it('returns the pi-ui section without the source comment', () => {
    expect(capabilitySections(['pi-ui', 'pi-ui'])).toEqual(['# pi-ui blocks\n\nUse blocks.'])
  })

  it('keeps browser control off while the Browser panel experiment is off', () => {
    prefs.browser = false
    expect(capabilitySections(['browser'])).toEqual([])
    expect(capabilityToolFamilies(['browser'])).toEqual([])
    expect(capabilityCatalog().find((c) => c.id === 'browser')).toMatchObject({ available: false, reason: 'browser-panel-off', tools: 21 })
    expect(capabilityCatalog().find((c) => c.id === 'pi-ui')?.promptTokens).toBeGreaterThan(0)
  })

  it('activates browser tools and guidance when the panel is on', () => {
    prefs.browser = true
    expect(capabilityToolFamilies(['browser', 'pi-ui'])).toEqual(['browser'])
    expect(capabilitySections(['browser'])[0]).toMatch(/^# Built-in browser/)
    expect(capabilityCatalog().find((c) => c.id === 'browser')?.available).toBe(true)
  })
})

describe('capability token estimate', () => {
  it('counts tool definitions, not only the prompt text', async () => {
    const { capabilityCatalog } = await import('./catalog')
    const browser = capabilityCatalog().find((c) => c.id === 'browser')!
    // 21 tool schemas are ~10k characters; the guidance alone is under 1k.
    // Tool schemas dominate (~1.7k tokens); the guidance alone is ~300.
    expect(browser.promptTokens).toBeGreaterThan(1500)
  })
})

describe('deferred browser tools', () => {
  it('counts only the core tools and tells the model about tool_search', () => {
    prefs.browser = true
    defer = false
    const all = capabilityCatalog().find((c) => c.id === 'browser')!
    expect(all.coreTools).toBeUndefined()
    expect(capabilitySections(['browser'])[0]).not.toContain('tool_search')
    defer = true
    const lean = capabilityCatalog().find((c) => c.id === 'browser')!
    expect(lean.coreTools).toBe(6)
    expect(lean.promptTokens).toBeLessThan(all.promptTokens * 0.65)
    // Measured in a real request: ~736 tokens of tool definitions + ~471 of prompt section.
    expect(lean.promptTokens).toBeGreaterThan(1150)
    expect(lean.promptTokens).toBeLessThan(1260)
    expect(capabilitySectionMap(['browser', 'pi-ui'])).toEqual({
      'pi-ui': '# pi-ui blocks\n\nUse blocks.',
      browser: expect.stringContaining('tool_search'),
    })
    defer = false
  })
})
