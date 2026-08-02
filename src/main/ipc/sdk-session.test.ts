import { describe, expect, it } from 'vitest'
import { validateSelectedSdkModule } from './sdk-session'

describe('selected SDK module probe', () => {
  it('rejects the legacy factory shape without ModelRuntime services', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
        createAgentSession: () => ({}),
      }),
    ).toThrow('SDK 缺少 ModelRuntime session services')
  })

  it('accepts the runtime session factory capability shape', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
        ModelRuntime: class {},
        createAgentSessionRuntime: () => ({}),
        createAgentSessionServices: () => ({}),
        createAgentSessionFromServices: () => ({}),
      }),
    ).not.toThrow()
  })

  it('rejects a partial SDK without a usable session factory', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
        createAgentSessionRuntime: () => ({}),
      }),
    ).toThrow('SDK 缺少 ModelRuntime session services')
  })
})
