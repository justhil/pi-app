import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'
import { useContextMenuPosition } from '@renderer/features/workspace/context-menu-shared'
import { dismissAllTimelineHovers } from './timeline-hover-guard'

export type TimelineContextMenuItem =
  | {
      type?: 'item'
      id: string
      label: string
      icon?: ReactNode
      disabled?: boolean
      danger?: boolean
      onSelect: () => void
    }
  | {
      type: 'separator'
      id: string
    }

interface MenuRequest {
  x: number
  y: number
  header?: string
  items: TimelineContextMenuItem[]
}

type Listener = (menu: MenuRequest | null) => void

let currentMenu: MenuRequest | null = null
const listeners = new Set<Listener>()

function notify(): void {
  for (const fn of [...listeners]) fn(currentMenu)
}

export function openTimelineContextMenu(req: MenuRequest): void {
  const actionable = req.items.filter((item) => item.type !== 'separator')
  if (actionable.length === 0) return
  dismissAllTimelineHovers()
  currentMenu = req
  notify()
}

export function closeTimelineContextMenu(): void {
  if (!currentMenu) return
  currentMenu = null
  notify()
}

/**
 * Returns true if the contextmenu event originated from an editable field or a link
 * that manages its own menu/selection interaction.
 */
export function shouldBypassTimelineContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('textarea, input, [contenteditable="true"], a[href]')) return true
  return false
}

export function getActiveTextSelection(): string {
  try {
    return window.getSelection()?.toString().trim() ?? ''
  } catch {
    return ''
  }
}

export function TimelineContextMenuHost() {
  const [menu, setMenu] = useState<MenuRequest | null>(() => currentMenu)
  const panelRef = useRef<HTMLDivElement>(null)
  const pos = useContextMenuPosition(menu, panelRef, [menu?.items.length, menu?.header])

  useEffect(() => {
    const listener: Listener = (next) => setMenu(next)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      closeTimelineContextMenu()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeTimelineContextMenu()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const buttons = Array.from(
          panelRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [],
        )
        if (!buttons.length) return
        e.preventDefault()
        const cur = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const nextIdx =
          e.key === 'ArrowDown'
            ? cur < 0 || cur === buttons.length - 1
              ? 0
              : cur + 1
            : cur <= 0
              ? buttons.length - 1
              : cur - 1
        buttons[nextIdx]?.focus()
      }
    }
    const onClose = () => closeTimelineContextMenu()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose)
    }
  }, [menu])

  if (!menu) return null

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      data-testid="timeline-context-menu"
      className="electron-no-drag fixed z-[140] min-w-[184px] max-w-[260px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-border/80 bg-[var(--bg-1,var(--background))] p-1 shadow-lg backdrop-blur-md"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.header ? (
        <div className="truncate px-2 py-1 text-[10.5px] font-medium text-muted-foreground/80">
          {menu.header}
        </div>
      ) : null}
      {menu.items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.id} role="separator" className="my-1 h-px bg-border/55" />
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            data-testid={`ctx-item-${item.id}`}
            onClick={() => {
              if (item.disabled) return
              closeTimelineContextMenu()
              item.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] leading-4 outline-none transition-colors',
              'focus-visible:bg-[var(--bg-hover)] hover:bg-[var(--bg-hover)]',
              item.danger
                ? 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10'
                : 'text-foreground',
              item.disabled && 'pointer-events-none opacity-40',
            )}
          >
            {item.icon ? <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center opacity-80">{item.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
