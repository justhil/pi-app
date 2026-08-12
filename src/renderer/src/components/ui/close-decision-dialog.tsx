import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ipcClient, onCloseRequested } from '@renderer/lib/ipc-client'

type CloseAction = 'wait' | 'now' | 'cancel'

/**
 * Shown when the user closes the window while an agent turn is running.
 * The main process intercepts the close and asks for a decision:
 * - wait: close after the running turn (incl. auto-compaction) settles, so the
 *   session tail is saved and can be continued later (e.g. with the pi CLI).
 * - now: close immediately (aborts the in-flight turn).
 * - cancel: keep the window open.
 */
export function CloseDecisionDialog() {
  const { t } = useTranslation()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    return onCloseRequested(() => {
      setWaiting(false)
      setOpen(true)
    })
  }, [])

  // Tell main the dialog is actually visible so its no-answer fallback is
  // cleared — an unanswered prompt must never abort the running turn.
  useEffect(() => {
    if (!open) return
    void ipcClient.invoke('window:close-decision-shown').catch(() => {})
  }, [open])

  const decide = (action: CloseAction) => {
    void ipcClient.invoke('window:close-decision', { action })
    if (action === 'wait') {
      setWaiting(true)
    } else {
      setOpen(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') decide('cancel')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, waiting])

  if (!open) return null

  return createPortal(
    <div
      className="electron-no-drag fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) decide('cancel')
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {waiting ? (
          <>
            <h2 id={titleId} className="mb-2 text-lg font-semibold text-foreground">
              {t('common:window.waitingTitle')}
            </h2>
            <p className="mb-4 text-base leading-relaxed text-muted-foreground">
              {t('common:window.waitingMessage')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => decide('cancel')}
              >
                {t('common:window.cancelWait')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id={titleId} className="mb-2 text-lg font-semibold text-foreground">
              {t('common:window.closeWhileRunningTitle')}
            </h2>
            <p className="mb-4 text-base leading-relaxed text-muted-foreground">
              {t('common:window.closeWhileRunningMessage')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => decide('wait')}
              >
                {t('common:window.waitThenClose')}
              </button>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                  onClick={() => decide('cancel')}
                >
                  {t('common:cancel')}
                </button>
                <button
                  className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => decide('now')}
                >
                  {t('common:window.closeNow')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
