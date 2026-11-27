import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import type { CanvasSurface } from '@shared/canvas-types'
import { MessageSquarePlus, Send, Sparkles, X } from '@renderer/components/icons'
import { sendComposerPrompt } from '@renderer/lib/send-composer-prompt'
import { quoteCanvasToComposer } from './canvas-store'

export interface CanvasSelectionAnchor {
  surfaceId: string
  surfaceTitle: string
  surfaceKind: CanvasSurface['kind']
  filePath?: string
  anchorType: 'text' | 'code' | 'element'
  excerpt: string
  locationLabel?: string
  htmlSnippet?: string
  rect: { left: number; top: number; width: number; height: number }
}

const MAX_EXCERPT_CHARS = 700
const MAX_HTML_SNIPPET_CHARS = 600

/**
 * Build a concise, token-efficient targeted edit prompt anchored strictly to the selected fragment
 * so the model modifies only that part via `canvas_update` or file edit instead of rewriting everything.
 */
export function formatCanvasPartialEditPrompt(
  anchor: CanvasSelectionAnchor,
  instruction: string,
): string {
  const cleanInstruction = instruction.trim()
  const excerpt =
    anchor.excerpt.length > MAX_EXCERPT_CHARS
      ? `${anchor.excerpt.slice(0, MAX_EXCERPT_CHARS)}…`
      : anchor.excerpt

  const lines: string[] = [
    `[画布局部修改 · ${anchor.surfaceTitle} (surface: ${anchor.surfaceId}, ${anchor.surfaceKind})]`,
  ]
  if (anchor.filePath) lines.push(`文件: ${anchor.filePath}`)
  if (anchor.locationLabel) lines.push(`位置: ${anchor.locationLabel}`)

  if (anchor.anchorType === 'code') {
    lines.push('目标代码片段:', '```', excerpt, '```')
  } else if (anchor.anchorType === 'element') {
    if (anchor.htmlSnippet) {
      const html =
        anchor.htmlSnippet.length > MAX_HTML_SNIPPET_CHARS
          ? `${anchor.htmlSnippet.slice(0, MAX_HTML_SNIPPET_CHARS)}…`
          : anchor.htmlSnippet
      lines.push('目标元素 HTML:', '```html', html, '```')
    }
    if (excerpt) lines.push(`元素文本: ${excerpt}`)
  } else {
    lines.push('目标段落:', ...excerpt.split('\n').map((l) => `> ${l}`))
  }

  if (cleanInstruction) {
    lines.push(`修改要求: ${cleanInstruction}`)
  }
  lines.push(
    anchor.filePath
      ? `请仅围绕上述局部片段修改文件 ${anchor.filePath}（画布将自动热重载），不要改动无关部分。`
      : `请仅围绕上述局部片段做修改，并通过 canvas_update(id="${anchor.surfaceId}") 就地更新，不要重写未涉及部分。`,
  )
  return lines.join('\n')
}

/** Find 1-based inclusive line range for a selected substring inside `sourceText`. */
export function computeSourceLineRange(
  sourceText: string,
  selectedText: string,
): { startLine: number; endLine: number } | null {
  if (!sourceText || !selectedText) return null
  const idx = sourceText.indexOf(selectedText)
  if (idx < 0) return null
  const startLine = sourceText.slice(0, idx).split('\n').length
  const spanLines = selectedText.split('\n').length - 1
  return { startLine, endLine: startLine + spanLines }
}

function findNearestHeading(node: Node | null, boundary: HTMLElement): string | undefined {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : node?.parentElement ?? null
  while (el && el !== boundary) {
    let prev = el.previousElementSibling
    while (prev) {
      if (/^H[1-6]$/.test(prev.tagName)) {
        const text = prev.textContent?.trim()
        if (text) return `章节「${text.slice(0, 48)}」`
      }
      prev = prev.previousElementSibling
    }
    el = el.parentElement
  }
  return undefined
}

/**
 * Capture text or code selection inside a Canvas surface container and expose a clamped popover anchor.
 * Automatically dismisses on scroll, Escape, or mode toggle so the popover never lingers.
 */
export function useTextSelectionAnchor(opts: {
  containerRef: RefObject<HTMLElement | null>
  surface: CanvasSurface
  filePath?: string
  mode: 'rendered' | 'source'
  sourceText?: string
  enabled?: boolean
}): {
  anchor: CanvasSelectionAnchor | null
  clearAnchor: () => void
} {
  const { containerRef, surface, filePath, mode, sourceText, enabled = true } = opts
  const [anchor, setAnchor] = useState<CanvasSelectionAnchor | null>(null)

  const clearAnchor = useCallback(() => {
    setAnchor(null)
  }, [])

  // Reset when mode, surface, or enabled state changes.
  useEffect(() => {
    setAnchor(null)
  }, [enabled, mode, surface.id])

  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    const captureSelection = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const anchorNode = sel.anchorNode
      const focusNode = sel.focusNode
      if (!anchorNode || !focusNode) return
      if (!container.contains(anchorNode) || !container.contains(focusNode)) return

      const raw = sel.toString()
      const trimmed = raw.trim()
      if (trimmed.length < 2) return

      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width <= 0 && rect.height <= 0) return

      let locationLabel: string | undefined
      if (mode === 'source' && sourceText) {
        const rangeInfo = computeSourceLineRange(sourceText, raw) ?? computeSourceLineRange(sourceText, trimmed)
        if (rangeInfo) {
          locationLabel =
            rangeInfo.startLine === rangeInfo.endLine
              ? `源码第 L${rangeInfo.startLine} 行`
              : `源码 L${rangeInfo.startLine}-L${rangeInfo.endLine}`
        } else {
          locationLabel = '源码片段'
        }
      } else {
        locationLabel = findNearestHeading(range.startContainer, container) ?? '正文选区'
      }

      setAnchor({
        surfaceId: surface.id,
        surfaceTitle: surface.title,
        surfaceKind: surface.kind,
        filePath,
        anchorType: mode === 'source' ? 'code' : 'text',
        excerpt: trimmed,
        locationLabel,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      })
    }

    const onScroll = () => setAnchor(null)
    container.addEventListener('mouseup', captureSelection)
    container.addEventListener('keyup', captureSelection)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('mouseup', captureSelection)
      container.removeEventListener('keyup', captureSelection)
      container.removeEventListener('scroll', onScroll)
    }
  }, [containerRef, enabled, filePath, mode, sourceText, surface.id, surface.kind, surface.title])

  return { anchor, clearAnchor }
}

const QUICK_PRESETS = [
  { label: '精简', instruction: '精简这一段表达，保留核心信息并去掉冗余。' },
  { label: '细化', instruction: '补充这一段的细节与边界说明，使其更完整具体。' },
  { label: '修正', instruction: '检查并修正这一段中的问题、排版或逻辑瑕疵。' },
] as const

export function CanvasSelectionPopover({
  anchor,
  onClose,
}: {
  anchor: CanvasSelectionAnchor | null
  onClose: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setInstruction('')
    setSending(false)
  }, [anchor])

  useEffect(() => {
    if (!anchor) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (popoverRef.current && target && popoverRef.current.contains(target)) return
      // Defer close slightly if user is starting a new drag-selection; clear cleanly on single click outside.
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [anchor, onClose])

  const posStyle = useMemo(() => {
    if (!anchor || typeof window === 'undefined') return undefined
    const popW = 340
    const popH = 112
    const margin = 10
    const vw = window.innerWidth || 1280
    const vh = window.innerHeight || 800
    const centerLeft = anchor.rect.left + anchor.rect.width / 2 - popW / 2
    const left = Math.max(margin, Math.min(vw - popW - margin, centerLeft))
    const aboveTop = anchor.rect.top - popH - 8
    const top =
      aboveTop >= margin
        ? aboveTop
        : Math.min(vh - popH - margin, anchor.rect.top + anchor.rect.height + 8)
    return { left, top, width: popW }
  }, [anchor])

  if (!anchor || typeof document === 'undefined') return null

  const sendDirect = async (customText?: string) => {
    const req = (customText ?? instruction).trim()
    if (!req || sending) return
    setSending(true)
    try {
      const prompt = formatCanvasPartialEditPrompt(anchor, req)
      const ok = await sendComposerPrompt(prompt)
      if (ok) {
        toast.success('已发送局部修改指令')
        window.getSelection()?.removeAllRanges()
        onClose()
      } else {
        // Fallback into Composer input so the user never loses their prompt when no session is bound yet.
        quoteCanvasToComposer(prompt)
        toast.message('已填入输入框，可选择会话后发送')
        onClose()
      }
    } finally {
      setSending(false)
    }
  }

  const insertIntoComposer = () => {
    const prompt = formatCanvasPartialEditPrompt(anchor, instruction.trim() || '请按以下要求修改这一局部：')
    quoteCanvasToComposer(prompt)
    toast.success('已将局部选区填入输入框')
    window.getSelection()?.removeAllRanges()
    onClose()
  }

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="局部评论与改写"
      data-canvas-selection-popover=""
      data-browser-overlay=""
      style={posStyle}
      onPointerDown={(e) => e.stopPropagation()}
      className="electron-no-drag fixed z-[550] rounded-xl border border-border/70 bg-popover p-2 text-[12px] text-popover-foreground shadow-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-secondary">
          <Sparkles className="h-3 w-3 shrink-0 text-[var(--brand)]" />
          <span className="truncate font-medium text-foreground">
            {anchor.locationLabel || (anchor.anchorType === 'element' ? '已选元素' : '已选片段')}
          </span>
          <span className="shrink-0 font-mono text-[10px] opacity-65">
            {anchor.excerpt.length > 0 ? `${anchor.excerpt.length}字` : 'DOM'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭局部改写"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Quick one-click preset chips */}
      <div className="mt-1.5 flex items-center gap-1">
        {QUICK_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={sending}
            onClick={() => void sendDirect(preset.instruction)}
            className="h-6 rounded-md border border-border/55 bg-background px-2 text-[11px] text-foreground-secondary transition-colors hover:border-border hover:bg-[var(--bg-hover)] hover:text-foreground disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={insertIntoComposer}
          title="将局部锚点放入对话输入框继续编辑"
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <MessageSquarePlus className="h-3 w-3" />
          <span>填入输入框</span>
        </button>
      </div>

      {/* Inline custom instruction input */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendDirect()
            } else if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault()
              insertIntoComposer()
            }
          }}
          placeholder="输入对这一局部的修改指令，回车直发…"
          className="h-7 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2 text-[11.5px] text-foreground outline-none focus:border-ring"
        />
        <button
          type="button"
          disabled={sending || !instruction.trim()}
          onClick={() => void sendDirect()}
          aria-label="发送局部修改指令"
          title="直接发送给当前会话 (Enter)"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-35"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
