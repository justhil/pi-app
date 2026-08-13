import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateWorkspace: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: mocks.activateWorkspace,
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}))

import { handleNotificationOpenSession } from './notification-open-session'

describe('handleNotificationOpenSession', () => {
  beforeEach(() => {
    mocks.activateWorkspace.mockReset()
    mocks.toastError.mockReset()
  })

  it('opens the remembered workspace/session and toasts when the session is gone', async () => {
    await handleNotificationOpenSession({
      ok: true,
      workspaceId: 'D:/proj',
      sessionId: 'sid',
      sessionFile: 'D:/proj/session.jsonl',
    })
    expect(mocks.activateWorkspace).toHaveBeenCalledWith('D:/proj', {
      sessionId: 'sid',
      sessionFile: 'D:/proj/session.jsonl',
    })

    await handleNotificationOpenSession({ ok: false, reason: 'gone', workspaceId: 'D:/proj' })
    expect(mocks.toastError).toHaveBeenCalled()
  })
})
