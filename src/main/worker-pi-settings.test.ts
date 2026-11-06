import { afterEach, describe, expect, it, vi } from 'vitest'
import { st } from '../worker/worker-runtime.js'
import { handleApplyhttpconnecttimeout, handleSetpisettings } from '../worker/handlers/worker-handlers-pi-settings'
import { widenHttpConnectTimeout } from '../worker/worker-http-connect'

vi.mock('../worker/worker-http-connect', () => ({ widenHttpConnectTimeout: vi.fn(() => true) }))

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
  st.activeSdkPath = null
  vi.mocked(widenHttpConnectTimeout).mockClear()
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

describe('handleApplyhttpconnecttimeout', () => {
  it('should_apply_the_timeout_from_the_active_sdk_when_the_worker_is_ready', async () => {
    st.sdk = {} as never
    st.activeSdkPath = '/sdk/index.js'
    const reply = vi.fn()

    await handleApplyhttpconnecttimeout({ type: 'applyHttpConnectTimeout', timeoutMs: 45000 } as never, reply)

    expect(widenHttpConnectTimeout).toHaveBeenCalledWith('/sdk/index.js', 45000)
    expect(reply).toHaveBeenCalledWith({ type: 'applyHttpConnectTimeout-done', ok: true })
  })

  it('should_leave_a_worker_still_loading_its_sdk_to_read_the_saved_value', async () => {
    const reply = vi.fn()

    await handleApplyhttpconnecttimeout({ type: 'applyHttpConnectTimeout', timeoutMs: 45000 } as never, reply)

    expect(widenHttpConnectTimeout).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledWith({ type: 'applyHttpConnectTimeout-done', ok: true })
  })
})
