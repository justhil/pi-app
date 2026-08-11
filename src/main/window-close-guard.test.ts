import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workerState = vi.hoisted(() => ({ hasActiveTurns: false }))

const appMock = vi.hoisted(() => ({ on: vi.fn(), quit: vi.fn() }))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [winMock.instance],
  },
  app: appMock,
}))

vi.mock('./worker-manager', () => ({
  workerManager: {
    get hasActiveTurns() {
      return workerState.hasActiveTurns
    },
  },
}))

const winMock = vi.hoisted(() => {
  const instance = {
    on: vi.fn(),
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
    close: vi.fn(),
  }
  return { instance }
})

import {
  installWindowCloseGuard,
  handleCloseDecision,
  handleCloseDecisionShown,
  guardAppQuit,
  __resetWindowCloseGuardForTest,
} from './window-close-guard'

type CloseEvent = { preventDefault: () => void }

describe('window-close-guard', () => {
  let closeHandler: ((e: CloseEvent) => void) | null = null
  const makeEvent = (): CloseEvent => ({ preventDefault: vi.fn() })

  beforeEach(() => {
    __resetWindowCloseGuardForTest()
    workerState.hasActiveTurns = false
    appMock.on.mockReset()
    appMock.quit.mockReset()
    winMock.instance.on.mockReset()
    winMock.instance.webContents.send.mockReset()
    winMock.instance.close.mockReset()
    closeHandler = null
    winMock.instance.on.mockImplementation((_evt: string, cb: (e: CloseEvent) => void) => {
      closeHandler = cb
    })
    installWindowCloseGuard(winMock.instance as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes immediately when no turn is running', () => {
    const e = makeEvent()
    closeHandler?.(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(winMock.instance.close).toHaveBeenCalled()
    expect(winMock.instance.webContents.send).not.toHaveBeenCalled()
  })

  it('intercepts close and asks the renderer while a turn is running', () => {
    workerState.hasActiveTurns = true
    const e = makeEvent()
    closeHandler?.(e)
    expect(winMock.instance.close).not.toHaveBeenCalled()
    expect(winMock.instance.webContents.send).toHaveBeenCalledWith('ipc:close-requested', {
      isStreaming: true,
    })
  })

  it('repeated close clicks while the dialog is open do not re-ask', () => {
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    closeHandler?.(makeEvent())
    expect(winMock.instance.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('decision now closes immediately', () => {
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    const res = handleCloseDecision('now')
    expect(res.ok).toBe(true)
    expect(winMock.instance.close).toHaveBeenCalled()
  })

  it('decision wait closes once the turn settles', () => {
    vi.useFakeTimers()
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    expect(winMock.instance.close).not.toHaveBeenCalled()

    handleCloseDecision('wait')
    workerState.hasActiveTurns = false
    vi.advanceTimersByTime(600)
    expect(winMock.instance.close).toHaveBeenCalled()
  })

  it('decision wait does not close while the turn keeps running', () => {
    vi.useFakeTimers()
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    handleCloseDecision('wait')
    vi.advanceTimersByTime(3000)
    expect(winMock.instance.close).not.toHaveBeenCalled()
  })

  it('wait has no fixed timeout: a long-running turn is never force-closed', () => {
    vi.useFakeTimers()
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    handleCloseDecision('wait')
    vi.advanceTimersByTime(30 * 60 * 1000)
    expect(winMock.instance.close).not.toHaveBeenCalled()
    expect(winMock.instance.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('decision cancel keeps the window open and allows a fresh decision later', () => {
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    expect(winMock.instance.webContents.send).toHaveBeenCalledTimes(1)

    expect(handleCloseDecision('cancel').ok).toBe(true)
    // A later close click re-asks instead of silently closing.
    workerState.hasActiveTurns = false
    const e = makeEvent()
    closeHandler?.(e)
    expect(winMock.instance.close).toHaveBeenCalled()
  })

  it('renderer ack of the visible dialog disarms the no-answer fallback', () => {
    vi.useFakeTimers()
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    handleCloseDecisionShown()
    // Past the original ack window with the dialog visible: no force close.
    vi.advanceTimersByTime(61 * 1000)
    expect(winMock.instance.close).not.toHaveBeenCalled()
  })

  it('without a renderer ack the no-answer fallback unblocks the window', () => {
    vi.useFakeTimers()
    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())
    vi.advanceTimersByTime(61 * 1000)
    expect(winMock.instance.close).toHaveBeenCalled()
  })

  it('invalid action is rejected', () => {
    const res = handleCloseDecision('bogus' as never)
    expect(res).toEqual({ ok: false, reason: 'invalid_action' })
  })

  describe('guardAppQuit (tray Quit / Cmd+Q)', () => {
    it('allows quit when no turn is running', () => {
      const e = makeEvent()
      expect(guardAppQuit(e)).toBe(true)
      expect(e.preventDefault).not.toHaveBeenCalled()
    })

    it('diverts quit to the close-decision flow while a turn is running', () => {
      workerState.hasActiveTurns = true
      const e = makeEvent()
      expect(guardAppQuit(e)).toBe(false)
      expect(e.preventDefault).toHaveBeenCalled()
      expect(winMock.instance.webContents.send).toHaveBeenCalledWith('ipc:close-requested', {
        isStreaming: true,
      })
    })

    it('ignores repeated quit attempts while a decision is pending', () => {
      workerState.hasActiveTurns = true
      guardAppQuit(makeEvent())
      const e = makeEvent()
      expect(guardAppQuit(e)).toBe(false)
      expect(winMock.instance.webContents.send).toHaveBeenCalledTimes(1)
    })

    it('allows the quit after the user chose now, and re-issues app.quit', () => {
      workerState.hasActiveTurns = true
      guardAppQuit(makeEvent())
      handleCloseDecision('now')
      expect(appMock.quit).toHaveBeenCalled()
      expect(guardAppQuit(makeEvent())).toBe(true)
    })
  })
})
