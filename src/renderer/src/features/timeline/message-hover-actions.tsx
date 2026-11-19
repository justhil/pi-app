import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Check, Undo2, GitFork, Pencil } from '@renderer/components/icons'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  canActivateTimelineHover,
  claimTimelineHoverOwner,
  releaseTimelineHoverOwner,
  subscribeTimelineScrollLock,
} from './timeline-hover-guard'

/** Hover actions for messages: copy, edit, rewind, fork (user) */
function MessageHoverActionsImpl({
  text,
  timestamp,
  align,
  sessionEntryId,
  editEntryId,
  editDisabled = false,
  onEdit,
  onRewind,
  onFork,
}: {
  text: string
  timestamp?: number
  align: 'left' | 'right'
  sessionEntryId?: string
  /** Own message entry ID for in-place editing (distinct from rewind fallback target). */
  editEntryId?: string
  editDisabled?: boolean
  onEdit?: (entryId: string) => void
  onRewind?: (entryId: string) => void
  onFork?: (entryId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const resolvedEditId = editEntryId ?? sessionEntryId
  const canEdit = Boolean(resolvedEditId) && !editDisabled
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className={cn('flex h-7 items-center gap-1.5', align === 'right' && 'flex-row-reverse justify-end')}>
      {onFork && (
        <button
          type="button"
          disabled={!sessionEntryId}
          onClick={() => sessionEntryId && onFork(sessionEntryId)}
          className="chrome-icon-btn flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary hover:text-primary disabled:opacity-35 disabled:pointer-events-none"
          title={
            sessionEntryId
              ? t('timeline:forkFromHere')
              : t('timeline:jumpNeedEntry')
          }
        >
          <GitFork className="h-3.5 w-3.5" />
        </button>
      )}
      {onRewind && (
        <button
          type="button"
          disabled={!sessionEntryId}
          onClick={() => sessionEntryId && onRewind(sessionEntryId)}
          className="chrome-icon-btn flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary hover:text-primary disabled:opacity-35 disabled:pointer-events-none"
          title={
            sessionEntryId
              ? t('timeline:jumpToNode')
              : t('timeline:jumpNeedEntry')
          }
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => resolvedEditId && onEdit(resolvedEditId)}
          className="chrome-icon-btn flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary hover:text-primary disabled:opacity-35 disabled:pointer-events-none"
          title={
            resolvedEditId
              ? t('timeline:editMessage')
              : t('timeline:edit.needEntryId')
          }
          aria-label={t('timeline:editMessage')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        className="chrome-icon-btn flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary"
        title={t('timeline:copy')}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {timestamp != null && (
        <span className="select-none text-[11px] tabular-nums text-foreground-secondary">
          {new Date(timestamp).toLocaleTimeString(i18n?.language, { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  )
}

export const MessageHoverActions = memo(MessageHoverActionsImpl)

/**
 * Message chrome: actions live in a fixed-height row (not an absolute overlay).
 * Hidden until hover/focus, but the row stays reserved so the next card cannot cover it.
 */
const SHOW_DELAY_RESERVED_MS = 55
const SHOW_DELAY_FLOATING_MS = 135
const HIDE_GRACE_MS = 150

export function MessageHoverShell({
  align,
  children,
  actions,
  reserve = false,
  floating = false,
}: {
  align: 'left' | 'right'
  children: ReactNode
  actions: ReactNode
  /** Keep a row in the document flow for the actions (user messages) instead of floating them. */
  reserve?: boolean
  /** Overlay actions without reserving extra vertical height (used for mid-turn prose blocks). */
  floating?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const pointerInside = useRef(false)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasActions = actions != null && actions !== false

  const clearShow = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])

  const clearHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }, [])

  const dismissNow = useCallback(() => {
    clearShow()
    clearHide()
    setHovered(false)
  }, [clearHide, clearShow])

  const scheduleReveal = useCallback(() => {
    if (!hasActions || !canActivateTimelineHover()) return
    clearHide()
    if (showTimer.current) return
    const delay = floating ? SHOW_DELAY_FLOATING_MS : SHOW_DELAY_RESERVED_MS
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      if (!pointerInside.current || !canActivateTimelineHover()) return
      claimTimelineHoverOwner(dismissNow)
      setHovered(true)
    }, delay)
  }, [clearHide, dismissNow, floating, hasActions])

  useEffect(() => {
    const unsub = subscribeTimelineScrollLock(() => {
      pointerInside.current = false
      dismissNow()
    })
    return () => {
      unsub()
      clearShow()
      clearHide()
      releaseTimelineHoverOwner(dismissNow)
    }
  }, [clearHide, clearShow, dismissNow])

  return (
    <div
      className={cn('message-hover-shell', align === 'right' && 'items-end')}
      onMouseEnter={() => {
        pointerInside.current = true
        scheduleReveal()
      }}
      onMouseMove={() => {
        pointerInside.current = true
        if (!hovered) {
          scheduleReveal()
        }
      }}
      // Short grace period so moving the pointer onto the actions never drops them,
      // while claiming another row or scrolling still dismisses this one immediately.
      onMouseLeave={() => {
        pointerInside.current = false
        clearShow()
        clearHide()
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null
          releaseTimelineHoverOwner(dismissNow)
          setHovered(false)
        }, HIDE_GRACE_MS)
      }}
      onFocusCapture={() => {
        clearShow()
        clearHide()
        claimTimelineHoverOwner(dismissNow)
        setHovered(true)
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          releaseTimelineHoverOwner(dismissNow)
          setHovered(false)
        }
      }}
    >
      {children}
      {hasActions ? (
        <div
          className={cn(
            'message-actions-slot',
            reserve && !floating && 'message-actions-slot--reserved',
            floating && 'message-actions-slot--floating',
            align === 'right' && 'message-actions-slot--end',
            hovered && 'message-actions-slot-visible',
          )}
        >
          <div className="message-actions-slot-inner">{actions}</div>
        </div>
      ) : null}
    </div>
  )
}
