import { afterEach, describe, expect, it } from 'vitest'
import { capabilitiesExtension, capabilitySectionsForTest, setCapabilitySections, withCapabilities } from './worker-capabilities'

afterEach(() => setCapabilitySections({}))

const event = (sections: Record<string, string> = {}) => ({ systemPrompt: 'base', systemPromptOptions: { sections } })

describe('worker capabilities', () => {
  it('keys sections by capability id and ignores blank values', () => {
    setCapabilitySections({ 'pi-ui': '# pi-ui', browser: '  ', x: 42 })
    expect(capabilitySectionsForTest()).toEqual({ desktop_pi_ui: '# pi-ui' })
    setCapabilitySections(['# legacy'])
    expect(capabilitySectionsForTest()).toEqual({ desktop_capability_0: '# legacy' })
    setCapabilitySections(undefined)
    expect(capabilitySectionsForTest()).toEqual({})
  })

  it('writes enabled capabilities into structured prompt sections instead of replacing the prompt', () => {
    setCapabilitySections({ 'pi-ui': '# pi-ui', browser: '# browser' })
    const e = event({ project: 'keep' })
    expect(withCapabilities(e)).toBeUndefined()
    expect(e.systemPromptOptions.sections).toEqual({ project: 'keep', desktop_pi_ui: '# pi-ui', desktop_browser: '# browser' })
  })

  it('removes a section when its capability is switched off, leaving other sections alone', () => {
    setCapabilitySections({ browser: '# browser' })
    const e = event({ project: 'keep', desktop_pi_ui: '# pi-ui', desktop_browser: '# browser' })
    expect(withCapabilities(e)).toBeUndefined()
    expect(e.systemPromptOptions.sections).toEqual({ project: 'keep', desktop_browser: '# browser' })
  })

  it('falls back to appending for runtimes without structured sections', () => {
    setCapabilitySections({})
    expect(withCapabilities({ systemPrompt: 'base' })).toBeUndefined()
    setCapabilitySections({ 'pi-ui': '# pi-ui', browser: '# browser' })
    expect(withCapabilities({ systemPrompt: 'base' })).toEqual({ systemPrompt: 'base\n\n# pi-ui\n\n# browser' })
  })

  it('registers a before_agent_start hook that follows the switch per turn', async () => {
    const handlers: Record<string, (event: unknown) => unknown> = {}
    const pi = { on: (name: string, fn: (event: unknown) => unknown) => (handlers[name] = fn) }
    const ext = capabilitiesExtension as { name: string; hidden?: boolean; factory: (api: unknown) => void }
    expect(ext.hidden).toBe(true)
    await ext.factory(pi)
    expect(Object.keys(handlers)).toEqual(['before_agent_start'])
    setCapabilitySections({ 'pi-ui': '# pi-ui' })
    const on = event()
    handlers.before_agent_start(on)
    expect(on.systemPromptOptions.sections).toEqual({ desktop_pi_ui: '# pi-ui' })
    setCapabilitySections({})
    const off = event({ desktop_pi_ui: '# pi-ui' })
    handlers.before_agent_start(off)
    expect(off.systemPromptOptions.sections).toEqual({})
  })
})
