import { describe, expect, it, vi } from 'vitest'

vi.mock('./pi-ui.md?raw', () => ({ default: '<!-- source note -->\n# pi-ui blocks\n\nUse blocks.' }))

const { capabilityCatalog, capabilitySections } = await import('./catalog')

describe('capability catalog', () => {
  it('yields nothing when no capability is on', () => {
    expect(capabilitySections([])).toEqual([])
    expect(capabilitySections(undefined)).toEqual([])
    expect(capabilitySections(['nope'])).toEqual([])
  })

  it('returns the pi-ui section without the source comment', () => {
    expect(capabilitySections(['pi-ui', 'pi-ui'])).toEqual(['# pi-ui blocks\n\nUse blocks.'])
  })

  it('ignores capabilities that are not available yet', () => {
    expect(capabilitySections(['browser'])).toEqual([])
    expect(capabilityCatalog().find((c) => c.id === 'browser')?.available).toBe(false)
    expect(capabilityCatalog().find((c) => c.id === 'pi-ui')?.promptTokens).toBeGreaterThan(0)
  })
})
