import { describe, expect, it } from 'vitest'
import { isCompletionNotificationShortcut } from './completion-notification-shortcut'

describe('completion notification shortcut', () => {
  it('matches only command-or-control plus shift plus n on keydown', () => {
    expect(isCompletionNotificationShortcut({ type: 'keyDown', key: 'N', control: true, meta: false, shift: true, alt: false })).toBe(true)
    expect(isCompletionNotificationShortcut({ type: 'keyDown', key: 'n', control: false, meta: true, shift: true, alt: false })).toBe(true)
    expect(isCompletionNotificationShortcut({ type: 'keyUp', key: 'n', control: true, meta: false, shift: true, alt: false })).toBe(false)
    expect(isCompletionNotificationShortcut({ type: 'keyDown', key: 'n', control: true, meta: false, shift: false, alt: false })).toBe(false)
    expect(isCompletionNotificationShortcut({ type: 'keyDown', key: 'n', control: true, meta: false, shift: true, alt: true })).toBe(false)
  })
})
