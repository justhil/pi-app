import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'

/** Elements that render above page content; a native WebContentsView would otherwise cover them. */
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
  '.shell-popover',
  '.live-theme-studio',
  '[data-sonner-toaster] [data-sonner-toast]',
  '[data-browser-overlay]',
].join(', ')

function intersects(a: DOMRect, b: DOMRect): boolean {
  return (
    a.width > 0 &&
    a.height > 0 &&
    a.left < b.right &&
    b.left < a.right &&
    a.top < b.bottom &&
    b.top < a.bottom
  )
}

/** Whether any dialog / menu / popover / floating drawer overlaps `target`. */
export function overlayCovers(target: Element, root: ParentNode = document): boolean {
  if (document.querySelector('[data-browser-resizing="true"]')) return true
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return true
  for (const el of root.querySelectorAll(OVERLAY_SELECTOR)) {
    if (target.contains(el)) continue
    if (intersects(el.getBoundingClientRect(), rect)) return true
  }
  return false
}

export function useOverlayCovering(ref: RefObject<HTMLElement | null>): boolean {
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    let frame = 0
    const check = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (ref.current) setCovered(overlayCovers(ref.current))
      })
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'data-state', 'data-browser-resizing', 'data-browser-overlay', 'class', 'style'],
    })
    window.addEventListener('resize', check)
    check()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', check)
      cancelAnimationFrame(frame)
    }
  }, [ref])
  return covered
}

/**
 * Keeps the Main-side WebContentsView glued to the placeholder element:
 * - Immediately hides synchronously (0ms) when `visible` flips to false so menus/overlays never get clipped underneath.
 * - Reports updated rects smoothly on mount, resize, and layout transitions; hides on unmount.
 */
export function useViewPlacement(
  ref: RefObject<HTMLElement | null>,
  tabId: string | null,
  visible: boolean,
  pageZoom = 1,
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !tabId) return

    if (!visible) {
      void ipcClient
        .invoke('browser.viewBounds', { tabId, x: 0, y: 0, width: 0, height: 0, visible: false })
        .catch(() => {})
      return
    }

    let frame = 0
    const send = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        void ipcClient
          .invoke('browser.viewBounds', {
            tabId,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            visible: r.width > 10 && r.height > 10,
            pageZoom,
          })
          .catch(() => {})
      })
    }
    send()
    const resizeObserver = new ResizeObserver(send)
    resizeObserver.observe(el)
    window.addEventListener('resize', send)
    document.addEventListener('transitionend', send, true)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', send)
      document.removeEventListener('transitionend', send, true)
      void ipcClient
        .invoke('browser.viewBounds', { tabId, x: 0, y: 0, width: 0, height: 0, visible: false })
        .catch(() => {})
    }
  }, [ref, tabId, visible, pageZoom])
}
