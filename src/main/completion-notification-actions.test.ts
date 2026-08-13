import { describe, expect, it } from 'vitest'
import {
  clearNotificationTargets,
  rememberNotificationTarget,
  takeNotificationTarget,
} from './completion-notification-actions'

describe('notification action cache', () => {
  it('returns only remembered ids and never accepts a raw path as the action', () => {
    clearNotificationTargets()
    rememberNotificationTarget('n-1', {
      workspaceId: 'D:/proj',
      sessionId: 'sid',
      sessionFile: 'D:/proj/session.jsonl',
    })
    expect(takeNotificationTarget('n-1')).toEqual({
      workspaceId: 'D:/proj',
      sessionId: 'sid',
      sessionFile: 'D:/proj/session.jsonl',
    })
    expect(takeNotificationTarget('D:/proj/session.jsonl')).toBeUndefined()
  })
})
