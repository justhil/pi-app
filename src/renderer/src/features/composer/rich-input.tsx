import { forwardRef, useRef, useEffect, useImperativeHandle } from 'react'
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

function syncEmpty(el: HTMLElement) {
  const hasText = Array.from(el.childNodes).some((n) =>
    n.nodeType === Node.TEXT_NODE ? !!(n.nodeValue || '').replace(/\u200B|\s/g, '')
    : n.nodeType === Node.ELEMENT_NODE ? !(n as HTMLElement).dataset.attachmentPath && (n as HTMLElement).tagName !== 'BR' || collectText(n).length > 0
    : false,
  ) || Array.from(el.querySelectorAll('[data-attachment-path]')).length > 0
  const empty = !hasText
  el.classList.toggle('is-empty', empty)
}

function collectText(node: Node): string {
  let s = ''
  node.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) s += c.nodeValue || ''
    else if (c.nodeType === Node.ELEMENT_NODE) s += collectText(c)
  })
  return s
}

export const RichInput = forwardRef<HTMLDivElement, RichInputProps>(function RichInput(
  { placeholder, disabled, onKeyDown, onPaste, onFocus, onBlur, onInput, className },
  ref,
) {
  const innerRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => innerRef.current as HTMLDivElement, [])

  const handleInput = () => {
    const el = innerRef.current
    if (!el) return
    requestAnimationFrame(() => {
      if (!innerRef.current) return
      const node = innerRef.current
      node.style.height = 'auto'
      node.style.height = Math.min(node.scrollHeight, 112) + 'px'
      syncEmpty(node)
    })
    onInput?.()
  }

  useEffect(() => {
    const el = innerRef.current
    if (el) { syncEmpty(el); handleInput() }
     
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
      className={cn('rich-input min-h-[2.5rem] w-full px-0.5 py-0 text-[14px] leading-[1.55] text-foreground disabled:cursor-default disabled:opacity-50', disabled && 'is-disabled', className)}
    />
  )
})