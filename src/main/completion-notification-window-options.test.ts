import { describe, expect, it } from 'vitest'
import { completionNotificationWindowOptions } from './completion-notification-window-options'

describe('completion notification window options', () => {
  it('keeps the host focusable so its action buttons can receive keyboard focus', () => {
    const options = completionNotificationWindowOptions('C:/preload.cjs')

    expect(options.focusable).toBe(true)
    expect(options.skipTaskbar).toBe(true)
    expect(options.webPreferences).toEqual(expect.objectContaining({
      preload: 'C:/preload.cjs',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    }))
  })
})
