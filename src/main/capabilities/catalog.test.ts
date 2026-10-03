import { describe, expect, it, vi } from 'vitest'

vi.mock('./pi-ui.md?raw', () => ({ default: '<!-- source note -->\n# pi-ui blocks\n\nUse blocks.' }))
const prefs: { browser?: boolean } = {}

const { capabilityCatalog, capabilitySections, capabilityToolFamilies, configureCapabilities } = await import('./catalog')
configureCapabilities({ browserPanelEnabled: () => !!prefs.browser })

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
    expect(capabilityCatalog().find((c) => c.id === 'browser')).toMatchObject({ available: false, reason: 'browser-panel-off', tools: 8 })
    expect(capabilityCatalog().find((c) => c.id === 'pi-ui')?.promptTokens).toBeGreaterThan(0)
  })

  it('activates browser tools and guidance when the panel is on', () => {
    prefs.browser = true
    expect(capabilityToolFamilies(['browser', 'pi-ui'])).toEqual(['browser'])
    expect(capabilitySections(['browser'])[0]).toMatch(/^# Built-in browser/)
    expect(capabilityCatalog().find((c) => c.id === 'browser')?.available).toBe(true)
  })
})
