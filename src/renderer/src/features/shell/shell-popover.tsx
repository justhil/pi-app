import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from '@renderer/components/icons'

interface ShellPopoverProps {
  title: string
  anchorRef: RefObject<HTMLButtonElement>
  onClose: () => void
  children: ReactNode
}

/** Shared presentation only; session and notification state stays with the caller. */
export function ShellPopover({ title, anchorRef, onClose, children }: ShellPopoverProps) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState({ left: 12, top: 48, maxHeight: 480, width: 380 })

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const positionPanel = () => {
      const rect = anchor.getBoundingClientRect()
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1
      const width = Math.min(380, window.innerWidth / zoom - 24)
      const above = rect.top > window.innerHeight / 2
      const available = (above ? rect.top - 20 : window.innerHeight - rect.bottom - 20) / zoom
      const maxHeight = Math.max(100, Math.min(520, available))
      const height = Math.min(panel.scrollHeight + 2, maxHeight)
      const top = above ? rect.top / zoom - height - 8 : rect.bottom / zoom + 8
      setPosition({
        left: Math.max(12, Math.min(rect.left / zoom, window.innerWidth / zoom - width - 12)),
        top: Math.max(12, Math.min(top, window.innerHeight / zoom - height - 12)),
        maxHeight,
        width,
      })
    }
    positionPanel()
    const observer = new ResizeObserver(positionPanel)
    observer.observe(panel)
    observer.observe(document.documentElement)
    closeRef.current?.focus({ preventScroll: true })
    const onPointer = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose()
    }
    const onFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
      anchor.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', positionPanel)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', positionPanel)
    }
  }, [anchorRef, onClose])

  return createPortal(
    <div ref={panelRef} role="dialog" aria-label={title} className="shell-popover electron-no-drag" style={position} data-independent-scroll>
      <header className="shell-popover-heading">
        <h2>{title}</h2>
        <button ref={closeRef} type="button" className="workbench-icon" aria-label={t('common:close')} onClick={() => {
          onClose()
          anchorRef.current?.focus({ preventScroll: true })
        }}>
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="shell-popover-body scrollbar-overlay">{children}</div>
    </div>, document.body,
  )
}
