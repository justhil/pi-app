import { useRef, useState, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'

const DEFAULT_DELAY_MS = 420
const TOOLTIP_HIDE_MS = 80
const VIEWPORT_PAD = 10
const activeHideFns = new Set<() => void>()

export function hideAllDelayedTooltips() {
  for (const fn of activeHideFns) fn()
  activeHideFns.clear()
}

/** 计算 tooltip 在视口内的位置（优先在元素上方，不够则下方）。 */
function computeTooltipRect(host: HTMLElement): { left: number; top: number } {
  const rect = host.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 预估尺寸（实际用 CSS max-width 限制后精确测量，但预估够用）
  const estW = Math.min(380, vw - VIEWPORT_PAD * 2)
  const estH = 40

  const centerX = rect.left + rect.width / 2
  let left = centerX - estW / 2
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - estW - VIEWPORT_PAD))

  let top: number
  if (rect.top > estH + 12) {
    top = rect.top - estH - 8
  } else {
    top = rect.bottom + 8
    if (top + estH > vh - VIEWPORT_PAD) top = Math.max(VIEWPORT_PAD, vh - estH - VIEWPORT_PAD)
  }
  return { left, top }
}

export function DelayedTooltip({
  content,
  children,
  delayMs = DEFAULT_DELAY_MS,
  className,
}: {
  content: string
  children: ReactNode
  delayMs?: number
  className?: string
}) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const hostRef = useRef<HTMLSpanElement>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    showTimer.current = null
    hideTimer.current = null
  }

  const onEnter = () => {
    clearTimers()
    showTimer.current = setTimeout(() => {
      if (hostRef.current) setPos(computeTooltipRect(hostRef.current))
      setVisible(true)
    }, delayMs)
  }

  const onLeave = () => {
    if (showTimer.current) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
    hideTimer.current = setTimeout(() => setVisible(false), TOOLTIP_HIDE_MS)
  }

  return (
    <>
      <span
        ref={hostRef}
        className={cn('delayed-tooltip-host inline-flex max-w-full', className)}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {children}
      </span>
      {visible && content
        ? createPortal(
            <span role="tooltip" className="delayed-tooltip-bubble is-visible" style={pos}>
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}

/** 为 contenteditable 内纯 DOM chip 挂延迟 tooltip（portal 到 body，fixed 定位）。 */
export function wireDelayedTooltip(el: HTMLElement, content: string, delayMs = DEFAULT_DELAY_MS) {
  if (!content) return
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let bubble: HTMLSpanElement | null = null

  const clearTimers = () => {
    if (showTimer) clearTimeout(showTimer)
    if (hideTimer) clearTimeout(hideTimer)
    showTimer = null
    hideTimer = null
  }

  const removeBubble = () => {
    if (bubble?.isConnected) bubble.remove()
    bubble = null
  }

  const show = () => {
    removeBubble()
    bubble = document.createElement('span')
    bubble.className = 'delayed-tooltip-bubble is-visible'
    bubble.setAttribute('role', 'tooltip')
    bubble.textContent = content
    const { left, top } = computeTooltipRect(el)
    bubble.style.left = `${left}px`
    bubble.style.top = `${top}px`
    document.body.appendChild(bubble)
  }
  const hide = () => {
    if (bubble?.isConnected) {
      bubble.classList.remove('is-visible')
      setTimeout(removeBubble, 300)
    } else {
      removeBubble()
    }
    clearTimers()
  }
  activeHideFns.add(hide)

  el.addEventListener('mouseenter', () => {
    clearTimers()
    showTimer = setTimeout(show, delayMs)
  })
  el.addEventListener('mouseleave', () => {
    if (showTimer) {
      clearTimeout(showTimer)
      showTimer = null
    }
    hideTimer = setTimeout(hide, TOOLTIP_HIDE_MS)
  })
  if (el.parentElement) {
    const observer = new MutationObserver(() => {
      if (!el.isConnected) {
        hide()
        observer.disconnect()
        activeHideFns.delete(hide)
      }
    })
    observer.observe(el.parentElement, { childList: true, subtree: true })
  }
}
