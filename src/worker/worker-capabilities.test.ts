import { afterEach, describe, expect, it } from 'vitest'
import { capabilitiesExtension, capabilitySectionsForTest, setCapabilitySections, withCapabilities } from './worker-capabilities'

afterEach(() => setCapabilitySections([]))

describe('worker capabilities', () => {
  it('leaves the system prompt untouched when nothing is enabled', () => {
    setCapabilitySections([])
    expect(withCapabilities({ systemPrompt: 'base' })).toBeUndefined()
    setCapabilitySections(['  ', 42, null])
    expect(withCapabilities({ systemPrompt: 'base' })).toBeUndefined()
  })

  it('appends enabled sections for the turn and drops them when switched off', () => {
    setCapabilitySections(['# pi-ui', '# browser'])
    expect(withCapabilities({ systemPrompt: 'base' })).toEqual({ systemPrompt: 'base\n\n# pi-ui\n\n# browser' })
    setCapabilitySections(undefined)
    expect(capabilitySectionsForTest()).toEqual([])
    expect(withCapabilities({ systemPrompt: 'base' })).toBeUndefined()
  })

  it('registers a before_agent_start hook that follows the switch per turn', async () => {
    const handlers: Record<string, (event: { systemPrompt: string }) => unknown> = {}
    const pi = { on: (name: string, fn: (event: { systemPrompt: string }) => unknown) => (handlers[name] = fn) }
    const ext = capabilitiesExtension as { name: string; hidden?: boolean; factory: (api: unknown) => void }
    expect(ext.hidden).toBe(true)
    await ext.factory(pi)
    expect(Object.keys(handlers)).toEqual(['before_agent_start'])
    setCapabilitySections(['# pi-ui'])
    expect(handlers.before_agent_start({ systemPrompt: 'base' })).toEqual({ systemPrompt: 'base\n\n# pi-ui' })
    setCapabilitySections([])
    expect(handlers.before_agent_start({ systemPrompt: 'base' })).toBeUndefined()
  })
})
