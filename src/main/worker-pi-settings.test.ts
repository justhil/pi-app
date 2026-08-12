import { afterEach, describe, expect, it, vi } from 'vitest'
import { st } from '../worker/worker-runtime.js'
import { handleSetpisettings } from '../worker/handlers/worker-handlers-pi-settings'

function settingsManager() {
  return {
    globalSettings: {},
    markModified: vi.fn(),
    save: vi.fn(),
    flush: vi.fn(async () => {}),
    drainErrors: vi.fn(() => []),
    setDefaultModelAndProvider: vi.fn(),
    setDefaultProvider: vi.fn(),
    setDefaultModel: vi.fn(),
    setDefaultThinkingLevel: vi.fn(),
    setSteeringMode: vi.fn(),
    setFollowUpMode: vi.fn(),
    setTransport: vi.fn(),
    setCompactionEnabled: vi.fn(),
    setShellPath: vi.fn(),
    setImageAutoResize: vi.fn(),
    setEnabledModels: vi.fn(),
    setRetryEnabled: vi.fn(),
    setHideThinkingBlock: vi.fn(),
    setShowImages: vi.fn(),
    setBlockImages: vi.fn(),
    setEnableSkillCommands: vi.fn(),
    setQuietStartup: vi.fn(),
    setDefaultProjectTrust: vi.fn(),
    setShellCommandPrefix: vi.fn(),
    setNpmCommand: vi.fn(),
    setTreeFilterMode: vi.fn(),
    setDoubleEscapeAction: vi.fn(),
    setHttpIdleTimeoutMs: vi.fn(),
    setProjectTrusted: vi.fn(),
  }
}

afterEach(() => {
  st.session = null
  st.sdk = null
})

describe('handleSetpisettings', () => {
  it('should_persist_default_model_without_mutating_the_live_session_model', async () => {
    const manager = settingsManager()
    const setModel = vi.fn()
    st.session = {
      settingsManager: manager,
      setModel,
    } as never
    const reply = vi.fn()

    await handleSetpisettings(
      {
        type: 'setPiSettings',
        patch: { defaultProvider: 'openai', defaultModel: 'gpt-5' },
      } as never,
      reply,
    )

    expect(manager.setDefaultModelAndProvider).toHaveBeenCalledWith('openai', 'gpt-5')
    expect(setModel).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledWith({ type: 'setPiSettings-done', ok: true })
  })
})
