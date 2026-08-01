import { describe, expect, it } from 'vitest'
import { validateSelectedSdkModule } from './sdk-session'

describe('selected SDK module probe', () => {
  it('accepts the legacy session factory capability shape', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
        createAgentSession: () => ({}),
      }),
    ).not.toThrow()
  })

  it('accepts the runtime session factory capability shape', () => {
    expect(() =>
      validateSelectedSdkModule({
        getAgentDir: () => '/agent',
        SessionManager: { create: () => ({}) },
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
    ).toThrow('SDK 缺少创建 session 所需 export')
  })
})
