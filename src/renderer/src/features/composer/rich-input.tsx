import { forwardRef, useRef, useImperativeHandle, useLayoutEffect } from 'react'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import { cn } from '@renderer/lib/utils'

/** Max editor height (kept in sync with the max-height in globals.css; content scrolls beyond it). */
const MAX_EDITOR_HEIGHT = 112

export interface RichInputProps {
  placeholder?: string
  disabled?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
  onPaste?: (e: React.ClipboardEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  onInput?: () => void
  className?: string
}

/**
 * Placeholder visibility for contenteditable.
 * - Spaces / typed newlines hide placeholder (user is typing).
 * - ZWSP caret anchors and a lone structural <br> count as empty.
 * - Attachment chips always hide placeholder.
 * Exported so programmatic setContent / prefill can force-refresh.
 */
export function syncRichInputEmpty(el: HTMLElement): void {
  const hasAttachment = el.querySelectorAll('[data-attachment-path]').length > 0
  // Text nodes only (including space). Ignore ZWSP. Do not treat lone <br> as content —
  // empty contenteditable often has a single BR while still "empty".
  const textFromNodes = collectTextNodeContent(el).replace(/\u200B/g, '')
  const empty = !hasAttachment && textFromNodes.length === 0
  el.classList.toggle('is-empty', empty)
}

function collectTextNodeContent(node: Node): string {
  let text = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue || ''
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const element = child as HTMLElement
    if (element.dataset.attachmentPath) return
    if (element.tagName === 'BR') return
    text += collectTextNodeContent(child)
  })
  return text
}

/**
 * Content coordinates (top/bottom) of the collapsed caret relative to the editor's content,
 * independent of scrolling. Returns null when the caret is outside the editor, a selection is
 * active, or the position cannot be measured.
 */
function caretContentRange(
  el: HTMLElement,
  mutationObserver?: MutationObserver | null,
): { top: number; bottom: number } | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!range.collapsed || !el.contains(range.commonAncestorContainer)) return null

  const measure = (rect: DOMRect | null): { top: number; bottom: number } | null => {
    if (!rect || (rect.height <= 0 && rect.width <= 0)) return null
    const elRect = el.getBoundingClientRect()
    return {
      top: rect.top - elRect.top + el.scrollTop,
      bottom: rect.bottom - elRect.top + el.scrollTop,
    }
  }

  const direct = measure(range.getBoundingClientRect())
  if (direct) return direct

  // A collapsed caret at an element boundary (blank line / right after a <br>) can produce a
  // zero-sized rect in Chrome. Insert a temporary zero-width probe node at the caret, measure,
  // then remove it and restore the selection.
  // 探针插入/移除会被 editor 的 MutationObserver 当作内容变更，再次调度 rAF → 下一帧又插探针，
  // 形成永久测量循环。测量期间临时断开 observer，探针读写不再触发任何回调。
  if (mutationObserver) mutationObserver.disconnect()
  const probe = document.createElement('span')
  probe.style.cssText = 'display:inline-block;width:0;height:1px'
  probe.textContent = '\u200B'
  const savedNode = range.endContainer
  const savedOffset = range.endOffset
  range.insertNode(probe)
  const probed = measure(probe.getBoundingClientRect())
  probe.remove()
  if (mutationObserver) {
    mutationObserver.observe(el, { childList: true, characterData: true, subtree: true })
  }
  const sel2 = window.getSelection()
  if (sel2) {
    const restore = document.createRange()
    restore.setStart(savedNode, savedOffset)
    restore.collapse(true)
    sel2.removeAllRanges()
    sel2.addRange(restore)
  }
  return probed
}

/** Scroll the editor so the caret is back in view (no-op when the caret is absent/unmeasurable). */
function scrollCaretIntoView(el: HTMLElement, mutationObserver?: MutationObserver | null) {
  if (el.scrollHeight <= el.clientHeight) return
  const caret = caretContentRange(el, mutationObserver)
  if (!caret) return
  const viewTop = el.scrollTop
  const viewBottom = viewTop + el.clientHeight
  if (caret.bottom > viewBottom) {
    el.scrollTop = caret.bottom - el.clientHeight
  } else if (caret.top < viewTop) {
    el.scrollTop = caret.top
  }
}

export const RichInput = forwardRef<HTMLDivElement, RichInputProps>(function RichInput(
  { placeholder, disabled, onKeyDown, onPaste, onFocus, onBlur, onInput, className },
  ref,
) {
  const innerRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  // 探针测量期间要临时断开 MutationObserver（见 caretContentRange），
  // 通过 ref 传递避免闭包捕获旧实例。
  const mutationObserverRef = useRef<MutationObserver | null>(null)
  useImperativeHandle(ref, () => innerRef.current as HTMLDivElement, [])

  const refreshLayoutAndEmpty = () => {
    const node = innerRef.current
    if (!node) return
    // Reset height to 'auto' before re-reading scrollHeight so content can shrink; the reset
    // clamps the scrollbar to 0, so restore the previous scroll position after re-clamping.
    const prevScrollTop = node.scrollTop
    node.style.height = 'auto'
    node.style.height = Math.min(node.scrollHeight, MAX_EDITOR_HEIGHT) + 'px'
    syncRichInputEmpty(node)
    node.scrollTop = Math.min(prevScrollTop, Math.max(node.scrollHeight - node.clientHeight, 0))
    // Programmatic inserts (Shift+Enter, paste, voice input) skip the browser's caret-into-view
    // scrolling, so bring the caret back into view manually (no-op while content fits).
    scrollCaretIntoView(node, mutationObserverRef.current)
  }

  const scheduleRefreshLayoutAndEmpty = () => {
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null
      refreshLayoutAndEmpty()
    })
  }

  const handleInput = () => {
    if (!innerRef.current) return
    scheduleRefreshLayoutAndEmpty()
    onInput?.()
  }

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    // Start empty so CSS placeholder shows on mount.
    el.classList.add('is-empty')
    refreshLayoutAndEmpty()

    let observedWidth = el.getBoundingClientRect().width
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = entry.borderBoxSize[0]?.inlineSize ?? entry.target.getBoundingClientRect().width
      if (width === observedWidth) return
      observedWidth = width
      scheduleRefreshLayoutAndEmpty()
    })
    resizeObserver.observe(el, { box: 'border-box' })

    // Programmatic fills (rewind prefill, setContent, history) often skip `input` events.
    const mutationObserver = new MutationObserver(scheduleRefreshLayoutAndEmpty)
    mutationObserver.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    mutationObserverRef.current = mutationObserver
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      mutationObserverRef.current = null
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [])

  // 事件委托：点击 chip 的删除按钮 → 移除该 chip 及相邻 ZWSP，刷新输入态
  const handleClickCapture = (e: React.MouseEvent) => {
    const el = innerRef.current
    if (!el) return
    const target = e.target as HTMLElement
    const removeBtn = target.closest('.rich-attachment-remove') as HTMLElement | null
    if (!removeBtn) return
    e.preventDefault()
    e.stopPropagation()
    const chip = removeBtn.closest('.rich-attachment-chip') as HTMLElement | null
    if (!chip) return
    const prev = chip.previousSibling
    const next = chip.nextSibling
    if (prev && prev.nodeType === Node.TEXT_NODE && (prev.nodeValue || '') === '\u200B') prev.parentNode?.removeChild(prev)
    if (next && next.nodeType === Node.TEXT_NODE && (next.nodeValue || '') === '\u200B') next.parentNode?.removeChild(next)
    chip.parentNode?.removeChild(chip)
    el.normalize()
    hideAllDelayedTooltips()
    handleInput()
  }

  return (
    <div
      ref={innerRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
      onInput={handleInput}
      onClickCapture={handleClickCapture}
      className={cn(
        'rich-input is-empty min-h-[2.5rem] w-full px-0.5 py-0 text-[14px] leading-[1.55] text-foreground disabled:cursor-default disabled:opacity-50',
        disabled && 'is-disabled',
        className,
      )}
    />
  )
})