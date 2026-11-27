import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, CornerDownLeft } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'

export function formatQuotedSelection(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''
  const quotedLines = normalized.split('\n').map((line) => (line ? `> ${line}` : '>'))
  return `${quotedLines.join('\n')}\n\n`
}

function isEditableSelectionNode(node: Node | null): boolean {
  const el = node instanceof HTMLElement ? node : node?.parentElement
  if (!el) return false
  return Boolean(el.closest('textarea, input, [contenteditable="true"], [data-composer-root]'))
}

type ToolbarPosition = {
  left: number
  top: number
  placement: 'above' | 'below'
  text: string
}

export function TimelineSelectionToolbar({
  containerRef,
  contentRef,
  scrollRef,
  canQuote,
}: {
  containerRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  canQuote: boolean
}) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const pointerDownRef = useRef(false)
  const [pos, setPos] = useState<ToolbarPosition | null>(null)
  const [copied, setCopied] = useState(false)

  const computePosition = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (!container || !content || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setPos(null)
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      setPos(null)
      return
    }
    const anchorNode = sel.anchorNode
    const focusNode = sel.focusNode
    if (
      !anchorNode ||
      !focusNode ||
      !content.contains(anchorNode) ||
      !content.contains(focusNode) ||
      isEditableSelectionNode(anchorNode) ||
      isEditableSelectionNode(focusNode)
    ) {
      setPos(null)
      return
    }

    const range = sel.getRangeAt(0)
    const containerRect = container.getBoundingClientRect()
    const fallbackEl = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement
    const rect =
      typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : (fallbackEl?.getBoundingClientRect() ?? containerRect)
    const scale = container.offsetWidth > 0 ? containerRect.width / container.offsetWidth : 1
    const safeScale = scale || 1
    const containerW = container.offsetWidth || Math.max(containerRect.width, 320)
    const containerH = container.offsetHeight || Math.max(containerRect.height, 240)

    // Hide when selection has scrolled completely outside the timeline container
    if (
      rect.height > 0 &&
      (rect.bottom < containerRect.top + 4 || rect.top > containerRect.bottom - 4)
    ) {
      setPos(null)
      return
    }

    const relCenterX =
      rect.width > 0 || rect.left !== 0
        ? (rect.left + rect.width / 2 - containerRect.left) / safeScale
        : containerW / 2
    const relTop = (rect.top - containerRect.top) / safeScale
    const relBottom = (rect.bottom - containerRect.top) / safeScale
    const toolbarHalfWidth = canQuote ? 76 : 44
    const clampedLeft = Math.min(
      Math.max(relCenterX, toolbarHalfWidth + 8),
      Math.max(toolbarHalfWidth + 8, containerW - toolbarHalfWidth - 8),
    )
    const placement: 'above' | 'below' = relTop >= 42 ? 'above' : 'below'
    const rawTop = placement === 'above' ? relTop - 36 : relBottom + 8
    const clampedTop = Math.min(Math.max(6, rawTop), Math.max(6, containerH - 36))

    setPos({
      left: clampedLeft,
      top: clampedTop,
      placement,
      text,
    })
  }, [canQuote, containerRef, contentRef])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return
      pointerDownRef.current = true
      setCopied(false)
    }
    const onPointerUp = () => {
      pointerDownRef.current = false
      requestAnimationFrame(computePosition)
    }
    const onSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setPos(null)
        setCopied(false)
        return
      }
      if (!pointerDownRef.current) {
        computePosition()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPos(null)
        return
      }
      computePosition()
    }
    const scrollEl = scrollRef.current
    const onScroll = () => {
      if (pos) computePosition()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keyup', onKeyUp)
    scrollEl?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keyup', onKeyUp)
      scrollEl?.removeEventListener('scroll', onScroll)
    }
  }, [computePosition, pos, scrollRef])

  if (!pos) return null

  const handleCopy = () => {
    void navigator.clipboard.writeText(pos.text).then(() => {
      setCopied(true)
      window.setTimeout(() => {
        setCopied(false)
        window.getSelection()?.removeAllRanges()
        setPos(null)
      }, 650)
    })
  }

  const handleQuote = () => {
    const quoted = formatQuotedSelection(pos.text)
    if (!quoted) return
    useUIStore.getState().appendComposerPrefill(quoted, { preserveTrailingNewlines: true })
    window.getSelection()?.removeAllRanges()
    setPos(null)
  }

  return (
    <div
      ref={toolbarRef}
      data-pi-slot="timeline-selection-toolbar"
      role="toolbar"
      aria-label={t('timeline:contextMenu.copySelection')}
      onMouseDown={(e) => {
        // Keep selection intact when clicking toolbar actions
        e.preventDefault()
      }}
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        transform: 'translateX(-50%)',
      }}
      className="timeline-selection-toolbar absolute z-30 flex items-center gap-0.5 rounded-lg border border-border/80 bg-popover/95 px-1 py-0.5 text-[12px] text-popover-foreground shadow-md backdrop-blur-md"
    >
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-6 items-center gap-1 rounded-md px-2 font-medium text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            <span>{t('timeline:copied')}</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span>{t('timeline:copy')}</span>
          </>
        )}
      </button>
      {canQuote && (
        <>
          <span className="h-3.5 w-px bg-border/65" aria-hidden />
          <button
            type="button"
            onClick={handleQuote}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 font-medium text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
            <span>{t('timeline:quoteSelection')}</span>
          </button>
        </>
      )}
    </div>
  )
}
