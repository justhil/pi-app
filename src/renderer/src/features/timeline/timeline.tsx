import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronRight, CheckCircle2, XCircle, Loader2, User, Bot,
  CornerDownLeft, AlertCircle, Terminal
} from 'lucide-react'
import { useState, memo, useRef, useEffect, useCallback } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ThinkingIndicator, StreamingCaret, useStalledHint } from './tool-card-primitives'
import { ToolIcon } from './tool-icon'
import { renderToolCard } from './tool-card-templates'
import { resolveToolCardTemplate } from './tool-card-registry'
import MarkdownView from './markdown-view'

function ToolOutputExpanded({ item }: { item: any }) {
  const template = resolveToolCardTemplate(item.toolName)
  return <>{renderToolCard(item, template)}</>
}
const TimelineItemBase = memo(function TimelineItem({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false)
  // Hooks must be unconditional (Rules of Hooks): compute streaming/stalled before any early return.
  const streaming = (useUIStore.getState().streamingAssistantId === item.id)
  const stalled = useStalledHint(streaming, item.text?.length)

  if (item.type === 'user-message') {
    return (
      <div className="flex justify-end py-3 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[14px] leading-relaxed text-primary-foreground shadow-sm">
          {item.text}
        </div>
      </div>
    )
  }

  if (item.type === 'assistant-message') {
    if (!item.text) {
      return <ThinkingIndicator label="思考中" />
    }
    return (
      <div className="py-3 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="flex items-start gap-2.5">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
          <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-foreground">
            <MarkdownView>{item.text}</MarkdownView>
            {streaming && <StreamingCaret />}
          </div>
        </div>
        {stalled && (
          <div className="mt-1 pl-6 text-[11px] text-foreground-secondary/70">思考中…</div>
        )}
      </div>
    )
  }

  if (item.type === 'tool-call') {
    const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
    const hasToolBody = !!item.toolOutput || (!!item.toolDetails)
    // Dimmed single-line summary (ui-timeline-polish): statusLine preferred, else first line of output truncated.
    const rawSum = (item.toolStatusLine as string | undefined)
      || (() => { const o = (item.toolOutput || '').trim(); if (!o) return ''; const l = o.split('\n').find((x: string) => x.trim()) || ''; return l.length > 72 ? l.slice(0, 72) + '…' : l })()
    return (
      <div className="py-0.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <button
          onClick={() => hasToolBody && setExpanded(!expanded)}
          className={cn(
            'group flex w-full items-center gap-1.5 px-0.5 py-0.5 text-left transition-colors',
            !hasToolBody && 'cursor-default',
          )}
        >
          {hasToolBody && (
            <ChevronRight className={cn(
              'h-3 w-3 shrink-0 text-foreground-secondary/50 transition-transform duration-motion-fast',
              expanded && 'rotate-90'
            )} />
          )}
          <ToolIcon name={item.toolName} />
          <span className="text-[12px] font-mono text-foreground-secondary">{item.toolName}</span>
          {rawSum && (
            <span className="ml-1 max-w-[300px] truncate text-[11px] text-foreground-secondary/70">{rawSum}</span>
          )}
          {isRunning && <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-foreground-secondary/70" />}
          {!isRunning && item.isError && <XCircle className="ml-auto h-3 w-3 shrink-0 text-destructive/70" />}
          {!isRunning && !item.isError && hasToolBody && <CheckCircle2 className="ml-auto h-3 w-3 shrink-0 text-green-500/60" />}
        </button>
        {expanded && hasToolBody && (
          <div className="mt-1 ml-4 animate-in fade-in slide-in-from-bottom-1 duration-motion-fast ease-motion-ease">
            <ToolOutputExpanded item={item} />
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'slash') {
    const status = item.slashStatus || 'dispatched'
    const iconCls = status === 'error' ? 'text-destructive' : status === 'ok' ? 'text-green-500' : 'text-blue-500'
    const Icon = status === 'error' ? XCircle : status === 'ok' ? CheckCircle2 : CornerDownLeft
    const label =
      status === 'error' ? '执行失败' : status === 'ok' ? '完成' : item.text?.includes('失败') ? '失败' : '已派发'
    return (
      <div className="py-1.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5">
          <Icon className={cn('h-3.5 w-3.5 shrink-0', iconCls)} />
          <span className="font-mono text-[11px] font-medium">{item.slashCommand}</span>
          <span className={cn('text-[10px] uppercase tracking-wide', iconCls)}>{label}</span>
          {item.text && (
            <span className="truncate text-[11px] text-muted-foreground/50">{item.text}</span>
          )}
        </div>
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
        <div className="text-[14px] text-muted-foreground/60">
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
        <div className="text-[14px] text-muted-foreground/60">
          {t('timeline.placeholder')}
        </div>
      </div>
    )
  }

  const visible = items.slice(Math.max(0, items.length - renderCount))
  const hiddenCount = items.length - visible.length

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="mx-auto max-w-[720px] flex-1 overflow-y-auto px-4 py-4">
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
