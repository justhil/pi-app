import { useEffect, useRef, type RefObject } from 'react'

export const contextMenuItemClass =
  'w-full cursor-pointer px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border'

export const contextMenuPanelClass =
  'electron-no-drag fixed z-[500] min-w-[140px] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg'

export function useDismissContextMenu(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const dismissIfOutside = (target: EventTarget | null) => {
      const el = ref.current
      if (!el) return
      if (target instanceof Node && el.contains(target)) return
      onCloseRef.current()
    }

    const onPointerDown = (e: PointerEvent) => dismissIfOutside(e.target)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    const onScroll = (e: Event) => {
      const el = ref.current
      if (!el) return
      const t = e.target
      if (t instanceof Node && el.contains(t)) return
      onCloseRef.current()
    }
    const onContextMenu = (e: MouseEvent) => dismissIfOutside(e.target)
    const onResize = () => onCloseRef.current()

    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('contextmenu', onContextMenu, true)
    }, 0)

    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)

    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, ref])
}