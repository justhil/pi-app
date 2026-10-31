import { describe, expect, it } from 'vitest'
import { settingsSetSchema } from './schemas'

describe('sidebar style settings schema', () => {
  it('accepts compact and full and rejects unsupported values', () => {
    for (const value of ['compact', 'full']) {
      expect(settingsSetSchema.safeParse({ key: 'sidebarStyle', value }).success).toBe(true)
    }
    for (const value of ['unknown', null, true]) {
      expect(settingsSetSchema.safeParse({ key: 'sidebarStyle', value }).success).toBe(false)
    }
  })
})
