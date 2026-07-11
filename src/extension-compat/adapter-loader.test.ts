import { describe, expect, it } from 'vitest'
import {
  isStickySlashContinuation,
  resolveV2Slash,
  resolveV2SlashPrefix,
} from './adapter-loader'

describe('isStickySlashContinuation', () => {
  it('allows TUI glued alphanumeric continuation', () => {
    expect(isStickySlashContinuation('goalfoo', 'goal')).toBe(true)
    expect(isStickySlashContinuation('goal_status', 'goal')).toBe(true)
  })

  it('rejects colon-namespaced skill invocations as sticky /skill', () => {
    expect(isStickySlashContinuation('skill:my-skill', 'skill')).toBe(false)
    expect(isStickySlashContinuation('skill:enable', 'skill')).toBe(false)
  })

  it('allows exact invocation match', () => {
    expect(isStickySlashContinuation('skill', 'skill')).toBe(true)
    expect(isStickySlashContinuation('skill:enable', 'skill:enable')).toBe(true)
  })
})

describe('resolveV2SlashPrefix skill routing', () => {
  it('opens skills-manager config only for bare /skill', () => {
    const resolved = resolveV2SlashPrefix('/skill')
    expect(resolved?.adapterId).toBe('@vanillagreen/pi-skills-manager')
    expect(resolved?.behavior).toBe('config-page')
  })

  it('does not route /skill:name into skills-manager config-page', () => {
    const resolved = resolveV2SlashPrefix('/skill:my-awesome-skill')
    expect(resolved).toBeNull()
  })

  it('still resolves exact /skill:enable catalog entry', () => {
    const resolved = resolveV2SlashPrefix('/skill:enable')
    expect(resolved?.adapterId).toBe('@vanillagreen/pi-skills-manager')
    expect(resolved?.behavior).toBe('notify')
  })

  it('keeps TUI sticky prefix for /goalfoo', () => {
    const resolved = resolveV2SlashPrefix('/goalfoo')
    expect(resolved?.adapterId).toBe('pi-goal')
    expect(resolved?.behavior).toBe('notify')
  })

  it('exact resolve matches bare /skill', () => {
    expect(resolveV2Slash('/skill')?.behavior).toBe('config-page')
  })
})
