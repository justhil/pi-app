import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  FileText, FileEdit, Terminal, Wrench, AlertCircle, Archive,
  ChevronRight, CheckCircle2, XCircle, Loader2, User, Bot
} from 'lucide-react'
import { useState, memo, useRef, useEffect, useCallback } from 'react'
import { syntaxHighlight } from '@renderer/lib/syntax-highlight'

function ToolIcon({ name }: { name: string }) {
  const cls = "h-3.5 w-3.5"
  if (name === 'read') return <FileText className={cn(cls, "text-[hsl(var(--tool-read))]")} />
  if (name === 'edit' || name === 'write') return <FileEdit className={cn(cls, "text-[hsl(var(--tool-edit))]")} />
  if (name === 'bash') return <Terminal className={cn(cls, "text-[hsl(var(--tool-bash))]")} />
  return <Wrench className={cn(cls, "text-muted-foreground")} />
}

const TimelineItemBase = memo(function TimelineItem({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false)

  if (item.type === 'user-message') {
    return (
      <div className="flex justify-end py-2.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground shadow-sm">
          {item.text}
        </div>
      </div>
    )
  }

  if (item.type === 'assistant-message') {
    if (!item.text) {
      return (
        <div className="flex items-center gap-2 py-2.5">
          <Bot className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
          <div className="flex gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '120ms' }} />
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '240ms' }} />
          </div>
        </div>
      )
    }
    return (
      <div className="py-2.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="flex items-start gap-2.5">
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <div className="text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
            {item.text}
          </div>
        </div>
      </div>
    )
  }

  if (item.type === 'tool-call') {
    const isRunning = item.toolPhase === 'start'
    return (
      <div className="py-1.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 transition-all duration-motion-fast ease-motion-ease',
            item.isError
              ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/8'
              : 'border-border/70 bg-muted/30 hover:bg-muted/50',
          )}
        >
          <ToolIcon name={item.toolName} />
          <span className="text-[12px] font-mono font-medium text-foreground/80">{item.toolName}</span>
          {isRunning && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {!isRunning && item.isError && <XCircle className="ml-auto h-3.5 w-3.5 text-destructive" />}
          {!isRunning && !item.isError && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500/70" />}
          {item.toolOutput && (
            <ChevronRight className={cn(
              'h-3 w-3 text-muted-foreground/40 transition-transform',
              expanded && 'rotate-90'
            )} />
          )}
        </button>
        {expanded && item.toolOutput && (
          <div className="mt-1 overflow-hidden rounded-lg border border-border/50 bg-muted/40">
            <div className="overflow-auto p-2.5 text-[11px] font-mono leading-relaxed max-h-56">
              <pre className="whitespace-pre-wrap break-all text-muted-foreground" dangerouslySetInnerHTML={{ __html: syntaxHighlight(item.toolOutput, item.toolName) }} />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'compaction') {
    return (
      <div className="py-2">
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2">
          <Archive className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-[11px] text-muted-foreground">已压缩历史</span>
          {item.text && (
            <span className="truncate text-[11px] text-muted-foreground/40">{item.text.slice(0, 100)}...</span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'error') {
    return (
      <div className="py-1.5">
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-[12px] text-destructive">{item.text}</span>
        </div>
      </div>
    )
  }

  return null
})

export function Timeline() {
  const items = useUIStore((s) => s.timelineItems)
  const hasWorkspace = useUIStore((s) => s.currentWorkspace)
  const { t } = useTranslation()

  // Virtualization: render only a window of items, grow on scroll up
  const PAGE = 40
  const [renderCount, setRenderCount] = useState(PAGE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasNearBottomRef = useRef(true)

  // Reset window when session changes (item list replaced)
  const firstId = items[0]?.id
  useEffect(() => {
    setRenderCount(PAGE)
    // jump to bottom when new session loaded
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [firstId])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // If near top, load more
    if (el.scrollTop < 100 && renderCount < items.length) {
 const prevHeight = el.scrollHeight
      setRenderCount((c) => Math.min(c + PAGE, items.length))
      // keep scroll position stable after prepending
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight
      })
    }
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [renderCount, items.length])

  // Auto-scroll to bottom when new items arrive (only if user was already near bottom)
  const lastId = items[items.length - 1]?.id
  useEffect(() => {
    if (wasNearBottomRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
    }
  }, [lastId])

  if (!hasWorkspace) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground/40">
          <Terminal className="h-7 w-7" />
        </div>
        <div className="text-[13px] text-muted-foreground/50">
          点击左侧「打开项目」选择一个工作目录
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground/40">
          <Bot className="h-7 w-7" />
        </div>
        <div className="text-[13px] text-muted-foreground/50">
          {t('timeline.placeholder')}
        </div>
      </div>
    )
  }

  const visible = items.slice(Math.max(0, items.length - renderCount))
  const hiddenCount = items.length - visible.length

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 py-3">
      {hiddenCount > 0 && (
        <div className="py-2 text-center text-[11px] text-muted-foreground/40">
          ↑ 上还有 {hiddenCount} 条，滚动加载更多
        </div>
      )}
      {visible.map((item) => (
        <TimelineItemBase key={item.id} item={item} />
      ))}
      <div className="h-4" />
    </div>
  )
}
