import { app, BrowserWindow } from 'electron'
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
 * Both window close and app quit (tray Quit / Cmd+Q) are guarded. `forceClose`
 * bypasses the guard once a decision has been made.
 */
let forceClose = false
let closeDecisionPending = false
let decisionAckTimer: ReturnType<typeof setTimeout> | null = null
let waitPollTimer: ReturnType<typeof setInterval> | null = null
let pendingOrigin: 'window' | 'app' | null = null

const WAIT_POLL_MS = 500
/**
 * Fallback for a renderer that never answers: if it does not confirm the
 * decision dialog was actually displayed (crash / hang) within this window,
 * stop blocking the app window. Once the dialog is shown, the timer is cleared
 * and the user decides at their own pace — an unanswered prompt must never
 * abort a running turn.
 */
const DECISION_ACK_TIMEOUT_MS = 60 * 1000

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function stopWaitPoll(): void {
  if (waitPollTimer) {
    clearInterval(waitPollTimer)
    waitPollTimer = null
  }
}

function clearDecisionAckTimer(): void {
  if (decisionAckTimer) {
    clearTimeout(decisionAckTimer)
    decisionAckTimer = null
  }
}

function requestCloseDecision(origin: 'window' | 'app'): boolean {
  const win = getWindow()
  if (!win || win.isDestroyed()) return false
  pendingOrigin = origin
  closeDecisionPending = true
  clearDecisionAckTimer()
  decisionAckTimer = setTimeout(() => {
    if (!closeDecisionPending) return
    // Renderer never confirmed the dialog is visible (crash / hang): stop
    // blocking. The turn is already lost anyway — do not keep the app stuck.
    closeDecisionPending = false
    decisionAckTimer = null
    forceClose = true
    const winNow = getWindow()
    if (winNow && !winNow.isDestroyed()) winNow.close()
    if (origin === 'app') app.quit()
  }, DECISION_ACK_TIMEOUT_MS)
  win.webContents.send('ipc:close-requested', { isStreaming: true })
  return true
}

function closeNow(): void {
  stopWaitPoll()
  clearDecisionAckTimer()
  closeDecisionPending = false
  forceClose = true
  const win = getWindow()
  if (win && !win.isDestroyed()) win.close()
  // Tray Quit / Cmd+Q originated as app.quit(): closing the window alone leaves
  // the app running on darwin, so re-issue the quit (now passes the guard).
  if (pendingOrigin === 'app') app.quit()
}

function startWaitAndClose(): void {
  stopWaitPoll()
  // No fixed timeout: the user explicitly chose to wait, so the window closes
  // only once the turn (including compaction) settles. If it never settles,
  // the dialog's "Cancel waiting" remains the escape hatch.
  waitPollTimer = setInterval(() => {
    if (!workerManager.hasActiveTurns) {
      closeNow()
    }
  }, WAIT_POLL_MS)
}

export function installWindowCloseGuard(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (forceClose) return
    event.preventDefault()
    if (waitPollTimer || closeDecisionPending) {
      // Already waiting or asking — repeated close clicks must not re-ask.
      return
    }
    if (workerManager.hasActiveTurns) {
      requestCloseDecision('window')
      return
    }
    closeNow()
  })
}

/**
 * Guard for app.quit() paths (tray Quit, Cmd+Q, window menu). Returns true when
 * the quit should proceed normally (no running turn, or a decision was made);
 * false when the quit is being diverted to the close-decision flow.
 */
export function guardAppQuit(event: { preventDefault: () => void }): boolean {
  if (forceClose) return true
  if (waitPollTimer || closeDecisionPending) {
    // A decision is already pending — this repeated quit attempt is ignored.
    event.preventDefault()
    return false
  }
  if (workerManager.hasActiveTurns) {
    event.preventDefault()
    requestCloseDecision('app')
    return false
  }
  return true
}

export function handleCloseDecision(action: 'wait' | 'now' | 'cancel'): { ok: boolean; reason?: string } {
  const win = getWindow()
  if (!win) return { ok: false }
  if (action === 'wait') {
    closeDecisionPending = false
    clearDecisionAckTimer()
    startWaitAndClose()
  } else if (action === 'now') {
    closeNow()
  } else if (action === 'cancel') {
    closeDecisionPending = false
    clearDecisionAckTimer()
    stopWaitPoll()
    pendingOrigin = null
  } else {
    return { ok: false, reason: 'invalid_action' }
  }
  return { ok: true }
}

/** Renderer confirms the decision dialog is visible — the ack fallback no longer applies. */
export function handleCloseDecisionShown(): void {
  if (closeDecisionPending) clearDecisionAckTimer()
}

/** Test-only reset of module-level guard state. */
export function __resetWindowCloseGuardForTest(): void {
  forceClose = false
  closeDecisionPending = false
  clearDecisionAckTimer()
  stopWaitPoll()
  pendingOrigin = null
}
