import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMainWindow: vi.fn(),
  readSessionMetaFromFile: vi.fn(),
  win: {
    isMinimized: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  },
}))

vi.mock('electron', () => ({ BrowserWindow: {}, Notification: {}, ipcMain: {}, screen: {} }))
vi.mock('./window', () => ({ getMainWindow: mocks.getMainWindow }))
vi.mock('./session-file-meta', () => ({ readSessionMetaFromFile: mocks.readSessionMetaFromFile }))
vi.mock('./completion-notification-settings', () => ({ setCompletionDndUntil: vi.fn() }))
vi.mock('./app-icon', () => ({ resolveAppIcon: vi.fn() }))
vi.mock('./audio-trace', () => ({ traceAudio: vi.fn() }))

import { clearNotificationTargets, rememberNotificationTarget } from './completion-notification-actions'
import { openNotificationTarget } from './completion-notification-delivery'

describe('notification return to session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearNotificationTargets()
    mocks.getMainWindow.mockReturnValue(mocks.win)
    mocks.readSessionMetaFromFile.mockResolvedValue({ sessionId: 'sid' })
    rememberNotificationTarget('n-1', {
      workspaceId: 'D:/proj',
      sessionFile: 'D:/proj/session.jsonl',
    })
  })

  it('restores the hidden main window and sends the remembered session to its renderer', async () => {
    expect(await openNotificationTarget('n-1')).toBe(true)

    expect(mocks.win.restore).toHaveBeenCalledOnce()
    expect(mocks.win.show).toHaveBeenCalledOnce()
    expect(mocks.win.focus).toHaveBeenCalledOnce()
    expect(mocks.win.webContents.send).toHaveBeenCalledWith('ipc:notification-open-session', {
      ok: true,
      workspaceId: 'D:/proj',
      sessionId: 'sid',
      sessionFile: 'D:/proj/session.jsonl',
    })
  })

  it('reports failure when no main window remains', async () => {
    mocks.getMainWindow.mockReturnValue(null)

    expect(await openNotificationTarget('n-1')).toBe(false)
    expect(mocks.readSessionMetaFromFile).not.toHaveBeenCalled()
    expect(mocks.win.webContents.send).not.toHaveBeenCalled()
  })

  it('shows the main window and reports a deleted session', async () => {
    mocks.readSessionMetaFromFile.mockResolvedValue(null)

    expect(await openNotificationTarget('n-1')).toBe(false)
    expect(mocks.win.show).toHaveBeenCalledOnce()
    expect(mocks.win.webContents.send).toHaveBeenCalledWith('ipc:notification-open-session', {
      ok: false,
      reason: 'gone',
      workspaceId: 'D:/proj',
    })
  })

  it('does not open an unremembered notification target', async () => {
    expect(await openNotificationTarget('unknown')).toBe(false)
    expect(mocks.readSessionMetaFromFile).not.toHaveBeenCalled()
    expect(mocks.win.webContents.send).toHaveBeenCalledWith('ipc:notification-open-session', {
      ok: false,
      reason: 'missing',
    })
  })
})
