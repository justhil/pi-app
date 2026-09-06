import { describe, expect, it } from 'vitest'
import { formatShortcut, matchShortcut, type ShortcutBinding } from './shortcut-bindings'

function event(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'k',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  } as KeyboardEvent
}

describe('shortcut bindings', () => {
  const palette: ShortcutBinding = { key: 'k', ctrl: true, meta: true, shift: false, alt: false }

  it('matches ctrl or meta for palette', () => {
    expect(matchShortcut(event({ key: 'k', ctrlKey: true }), palette)).toBe(true)
    expect(matchShortcut(event({ key: 'k', metaKey: true }), palette)).toBe(true)
    expect(matchShortcut(event({ key: 'k' }), palette)).toBe(false)
  })

  it('formats with Ctrl on non-mac', () => {
    expect(formatShortcut(palette).toLowerCase()).toContain('k')
  })
})
