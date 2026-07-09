import { forwardRef, useRef, useImperativeHandle, useLayoutEffect } from 'react'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import { cn } from '@renderer/lib/utils'

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

export const RichInput = forwardRef<HTMLDivElement, RichInputProps>(function RichInput(
  { placeholder, disabled, onKeyDown, onPaste, onFocus, onBlur, onInput, className },
  ref,
) {
  const innerRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => innerRef.current as HTMLDivElement, [])

  const refreshLayoutAndEmpty = () => {
    const node = innerRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = Math.min(node.scrollHeight, 112) + 'px'
    syncRichInputEmpty(node)
  }

  const handleInput = () => {
    if (!innerRef.current) return
    requestAnimationFrame(() => {
      if (!innerRef.current) return
      refreshLayoutAndEmpty()
    })
    onInput?.()
  }

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    // Start empty so CSS placeholder shows on mount.
    el.classList.add('is-empty')
    syncRichInputEmpty(el)
    refreshLayoutAndEmpty()

    // Programmatic fills (rewind prefill, setContent, history) often skip `input` events.
    // MutationObserver keeps is-empty in sync for DOM writes.
    const observer = new MutationObserver(() => {
      syncRichInputEmpty(el)
    })
    observer.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    return () => observer.disconnect()
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