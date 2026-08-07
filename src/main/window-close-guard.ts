import { BrowserWindow } from 'electron'
import { workerManager } from './worker-manager'

/**
 * Closing the window while an agent turn is running would abort the in-flight
 * turn — its partial output is never written to the session file, so the
 * conversation tail is lost. Instead ask the renderer for a decision:
 *
 * - wait: poll until the turn (including auto-compaction) settles, then close.
 *   The finished session is fully on disk and can be continued later (CLI).
 * - now: close immediately, aborting the running turn (status quo behaviour).
 * - cancel: keep the window open and clear the pending decision.
 *
 * Tray quit / Cmd+Q go through the same window close path, so they are guarded
 * too. `forceClose` bypasses the guard once a decision has been made.
 */
let forceClose = false
let closeDecisionPending = false
let decisionTimeout: ReturnType<typeof setTimeout> | null = null
let waitPollTimer: ReturnType<typeof setInterval> | null = null

const WAIT_POLL_MS = 500
const WAIT_TIMEOUT_MS = 15 * 60 * 1000
/** If the renderer never answers the close request (crash), stop blocking the window. */
const DECISION_TIMEOUT_MS = 60 * 1000

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function stopWaitPoll(): void {
  if (waitPollTimer) {
    clearInterval(waitPollTimer)
    waitPollTimer = null
  }
}

function clearDecisionTimeout(): void {
  if (decisionTimeout) {
    clearTimeout(decisionTimeout)
    decisionTimeout = null
  }
}

function closeNow(win: BrowserWindow): void {
  stopWaitPoll()
  clearDecisionTimeout()
  closeDecisionPending = false
  forceClose = true
  if (!win.isDestroyed()) win.close()
}

function startWaitAndClose(win: BrowserWindow): void {
  stopWaitPoll()
  const startedAt = Date.now()
  waitPollTimer = setInterval(() => {
    const timedOut = Date.now() - startedAt > WAIT_TIMEOUT_MS
    if (!workerManager.hasActiveTurns || timedOut) {
      closeNow(win)
    }
  }, WAIT_POLL_MS)
}

export function installWindowCloseGuard(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (forceClose) return
    event.preventDefault()
    if (waitPollTimer) {
      // Already waiting for the running turn — ignore further close attempts.
      return
    }
    if (closeDecisionPending) {
      // Dialog is already open; a repeated close click must not re-ask.
      return
    }
    if (workerManager.hasActiveTurns) {
      closeDecisionPending = true
      clearDecisionTimeout()
      decisionTimeout = setTimeout(() => {
        closeDecisionPending = false
        decisionTimeout = null
        // Renderer never answered (crash / hang): fall back to closing now.
        const winNow = getWindow()
        if (winNow && !winNow.isDestroyed()) closeNow(winNow)
      }, DECISION_TIMEOUT_MS)
      win.webContents.send('ipc:close-requested', { isStreaming: true })
      return
    }
    closeNow(win)
  })
}

export function handleCloseDecision(action: 'wait' | 'now' | 'cancel'): { ok: boolean; reason?: string } {
  const win = getWindow()
  if (!win) return { ok: false }
  if (action === 'wait') {
    closeDecisionPending = false
    clearDecisionTimeout()
    startWaitAndClose(win)
  } else if (action === 'now') {
    closeNow(win)
  } else if (action === 'cancel') {
    closeDecisionPending = false
    clearDecisionTimeout()
    stopWaitPoll()
  } else {
    return { ok: false, reason: 'invalid_action' }
  }
  return { ok: true }
}

/** Test-only reset of module-level guard state. */
export function __resetWindowCloseGuardForTest(): void {
  forceClose = false
  closeDecisionPending = false
  clearDecisionTimeout()
  stopWaitPoll()
}
