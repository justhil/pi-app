import { describe, expect, it } from 'vitest'
import { systemNotificationSilent } from './completion-system-notification'

describe('system completion notification', () => {
  it('is audible only when the completion card enables sound', () => {
    expect(systemNotificationSilent(true)).toBe(false)
    expect(systemNotificationSilent(false)).toBe(true)
  })
})
