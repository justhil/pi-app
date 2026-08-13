import { describe, expect, it } from 'vitest'
import { notificationHostPageHtml } from './notification-host-page'

describe('notification host page', () => {
  it('exposes a focus request channel for the explicit keyboard entry', () => {
    const html = notificationHostPageHtml()

    expect(html).toContain('api.onFocus')
    expect(html).toContain("stack.querySelector('.card:last-child .open')?.focus()")
  })

  it('plays sound once per notification id across stack re-renders', () => {
    const html = notificationHostPageHtml()

    expect(html).toContain('const playedSoundIds = new Set()')
    expect(html).toContain("if (card.sound && !playedSoundIds.has(card.notificationId))")
    expect(html).toContain('playedSoundIds.add(card.notificationId)')
  })
})
