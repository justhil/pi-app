import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workerState = vi.hoisted(() => ({ hasActiveTurns: false }))

const appMock = vi.hoisted(() => ({ on: vi.fn(), quit: vi.fn() }))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [winMock.notification, winMock.instance],
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

vi.mock('./window', () => ({
  getMainWindow: () => winMock.instance,
}))

const winMock = vi.hoisted(() => {
  const instance = {
    on: vi.fn(),
    once: vi.fn(),
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
  }
  return { instance, notification: { ...instance, webContents: { send: vi.fn() } } }
})

import {
  installWindowCloseGuard,
  handleCloseDecision,
  handleCloseDecisionShown,
  guardAppQuit,
  setRunningTerminalsProbe,
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
    winMock.instance.once.mockReset()
    winMock.instance.webContents.send.mockReset()
    winMock.instance.restore.mockReset()
    winMock.instance.show.mockReset()
    winMock.instance.focus.mockReset()
    winMock.instance.hide.mockReset()
    winMock.instance.close.mockReset()
    closeHandler = null
    winMock.instance.on.mockImplementation((_evt: string, cb: (e: CloseEvent) => void) => {
      closeHandler = cb
    })
    installWindowCloseGuard(winMock.instance as never)
  })

  afterEach(() => {
    __resetWindowCloseGuardForTest()
    vi.useRealTimers()
  })

  it.each([false, true])('hides to an available tray without destroying the window (active turn: %s)', (hasActiveTurns) => {
    installWindowCloseGuard(winMock.instance as never, true)
    workerState.hasActiveTurns = hasActiveTurns
    const event = makeEvent()

    closeHandler?.(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(winMock.instance.hide).toHaveBeenCalledOnce()
    expect(winMock.instance.close).not.toHaveBeenCalled()
    expect(winMock.instance.webContents.send).not.toHaveBeenCalled()
    expect(appMock.quit).not.toHaveBeenCalled()
  })

  it('keeps running terminals alive when hiding to the tray', () => {
    installWindowCloseGuard(winMock.instance as never, true)
    setRunningTerminalsProbe(() => 2)

    closeHandler?.(makeEvent())

    expect(winMock.instance.hide).toHaveBeenCalledOnce()
    expect(winMock.instance.close).not.toHaveBeenCalled()
    expect(winMock.instance.webContents.send).not.toHaveBeenCalled()
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
      terminals: 0,
    })
  })

  it('asks before ending running terminals even without a turn', () => {
    setRunningTerminalsProbe(() => 2)
    closeHandler?.(makeEvent())
    expect(winMock.instance.close).not.toHaveBeenCalled()
    expect(winMock.instance.webContents.send).toHaveBeenCalledWith('ipc:close-requested', { isStreaming: false, terminals: 2 })
    handleCloseDecision('now')
    expect(winMock.instance.close).toHaveBeenCalled()
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

  it('scopes force close to the closing window', () => {
    const firstCloseHandler = closeHandler
    firstCloseHandler?.(makeEvent())

    const secondClose = vi.fn()
    const secondOn = vi.fn((_event: string, handler: (e: CloseEvent) => void) => {
      closeHandler = handler
    })
    installWindowCloseGuard({
      ...winMock.instance,
      on: secondOn,
      once: vi.fn(),
      close: secondClose,
    } as never)

    workerState.hasActiveTurns = true
    closeHandler?.(makeEvent())

    expect(secondClose).not.toHaveBeenCalled()
    expect(winMock.instance.webContents.send).toHaveBeenCalledWith('ipc:close-requested', {
      isStreaming: true,
      terminals: 0,
    })
  })

  describe('guardAppQuit (tray Quit / Cmd+Q)', () => {
    it('allows an idle tray window to close during an explicit quit', () => {
      installWindowCloseGuard(winMock.instance as never, true)
      expect(guardAppQuit(makeEvent())).toBe(true)
      const event = makeEvent()

      closeHandler?.(event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(winMock.instance.hide).not.toHaveBeenCalled()
    })

    it('closes a tray window after waiting for a running turn on explicit quit', () => {
      vi.useFakeTimers()
      installWindowCloseGuard(winMock.instance as never, true)
      workerState.hasActiveTurns = true
      expect(guardAppQuit(makeEvent())).toBe(false)
      expect(handleCloseDecision('wait').ok).toBe(true)
      vi.advanceTimersByTime(600)
      expect(winMock.instance.close).not.toHaveBeenCalled()

      workerState.hasActiveTurns = false
      vi.advanceTimersByTime(600)

      expect(winMock.instance.close).toHaveBeenCalledOnce()
      expect(appMock.quit).toHaveBeenCalledOnce()
      const event = makeEvent()
      closeHandler?.(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(winMock.instance.hide).not.toHaveBeenCalled()
    })

    it('keeps close-to-tray available after cancelling an explicit quit', () => {
      installWindowCloseGuard(winMock.instance as never, true)
      workerState.hasActiveTurns = true
      expect(guardAppQuit(makeEvent())).toBe(false)
      expect(handleCloseDecision('cancel').ok).toBe(true)

      closeHandler?.(makeEvent())

      expect(winMock.instance.hide).toHaveBeenCalledOnce()
      expect(winMock.instance.close).not.toHaveBeenCalled()
      expect(appMock.quit).not.toHaveBeenCalled()
    })

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
        terminals: 0,
      })
    })

    it('ignores repeated quit attempts while a decision is pending', () => {
      workerState.hasActiveTurns = true
      guardAppQuit(makeEvent())
      const e = makeEvent()
      expect(guardAppQuit(e)).toBe(false)
      expect(winMock.instance.webContents.send).toHaveBeenCalledTimes(1)
    })

    it('shows and focuses a hidden window before asking for a quit decision', () => {
      workerState.hasActiveTurns = true
      vi.spyOn(winMock.instance, 'isVisible').mockReturnValueOnce(false)
      const e = makeEvent()

      expect(guardAppQuit(e)).toBe(false)

      expect(winMock.instance.show).toHaveBeenCalledOnce()
      expect(winMock.instance.focus).toHaveBeenCalledOnce()
      expect(winMock.instance.webContents.send).toHaveBeenCalledWith('ipc:close-requested', {
        isStreaming: true,
        terminals: 0,
      })
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
