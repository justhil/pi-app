import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  CheckCircle2, XCircle,
  CornerDownLeft, AlertCircle, Terminal, Copy, Check
} from 'lucide-react'
import { useState, memo, useRef, useEffect, useCallback, Fragment } from 'react'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ThinkingIndicator, StreamingCaret, useStalledHint } from './tool-card-primitives'
import { ToolCallRow } from './tool-call-row'
import { ToolGroupSummary } from './tool-group-summary'
import { buildTimelineDisplayItems } from './timeline-display-items'
import MarkdownView from './markdown-view'

function MessageHoverActions({ text, timestamp, align }: { text: string; timestamp?: number; align: 'left' | 'right' }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className={cn('hover-reveal mt-1 flex h-6 items-center gap-1.5', align === 'right' && 'flex-row-reverse')}>
      <button
        type="button"
        onClick={copy}
        className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary transition-all duration-[var(--motion-fast)] ease-[var(--motion-ease)] hover:bg-[var(--bg-hover)] hover:text-foreground active:scale-95"
        title="复制"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
      {timestamp != null && (
        <span className="select-none text-[11px] tabular-nums text-foreground-secondary">
          {new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  )
}

const TimelineItemBase = memo(function TimelineItem({ item, prevType }: { item: any; prevType?: string }) {
  // Hooks must be unconditional (Rules of Hooks): compute streaming/stalled before any early return.
  const streaming = (useUIStore.getState().streamingAssistantId === item.id)
  const stalled = useStalledHint(streaming, item.text?.length)

  if (item.type === 'user-message') {
    return (
      <div className={cn('group ui-enter flex flex-col items-end', prevType === 'user-message' ? 'py-1' : 'py-2.5')}>
        <div
          className="max-w-[80%] px-3.5 py-2 text-[15px] leading-[1.7] text-foreground whitespace-pre-wrap break-words"
          style={{
            background: 'var(--message-user-bg)',
            borderRadius: '8px 0 8px 8px',
          }}
        >
          {item.text}
        </div>
        <MessageHoverActions text={item.text} timestamp={item.timestamp} align="right" />
      </div>
    )
  }

  if (item.type === 'assistant-message') {
    if (!item.text) {
      return <ThinkingIndicator label="思考中" />
    }
    return (
      <div className={cn('group ui-enter', prevType === 'assistant-message' ? 'py-1.5' : 'py-2.5')}>
        <div className={cn('min-w-0 text-[15px] leading-[1.7] text-foreground', streaming && 'animate-stream-fade')}>
          <MarkdownView>{item.text}</MarkdownView>
          {streaming && <StreamingCaret />}
        </div>
        {stalled && (
          <div className="mt-1 text-[11px] text-foreground-secondary">思考中…</div>
        )}
        {!streaming && <MessageHoverActions text={item.text} timestamp={item.timestamp} align="left" />}
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
        <div className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-1 text-[11px] text-foreground-secondary" style={{ background: 'var(--bg-1)' }}>
          <Icon className={cn('h-3 w-3 shrink-0 opacity-80', iconCls)} />
          <span className="font-mono font-medium text-foreground">{item.slashCommand}</span>
          <span className={cn('text-[10px] uppercase tracking-wide', iconCls)}>{label}</span>
          {item.text && (
            <span className="truncate text-foreground-secondary">{item.text}</span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'compaction') {
    return (
      <div className="py-2">
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 px-2.5 py-1.5 text-foreground-secondary" style={{ background: 'var(--bg-1)' }}>
          <Archive className="h-3 w-3 opacity-70" />
          <span className="text-[11px]">已压缩历史</span>
          {item.text && (
            <span className="truncate text-[11px] opacity-80">{item.text.slice(0, 100)}...</span>
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
        <p className="max-w-xs text-center text-[13px] leading-relaxed text-foreground-secondary">
          点击左侧「打开项目」选择工作目录，即可加载会话与 pi 配置
        </p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center animate-in fade-in duration-[var(--motion-slow)]">
        <div className="text-[15px] font-medium text-foreground">{t('timeline.placeholder')}</div>
        <p className="max-w-sm text-[13px] leading-relaxed text-foreground-secondary">
          在下方输入消息开始对话。输入 <span className="font-mono text-foreground">/</span> 可查看命令与技能。
        </p>
        <p className="text-[12px] text-foreground-secondary/80">侧栏可切换会话 · 右侧可查看 Review / Run / Trellis</p>
      </div>
    )
  }

  const visible = items.slice(Math.max(0, items.length - renderCount))
  const hiddenCount = items.length - visible.length
  const displayItems = buildTimelineDisplayItems(visible as any[])

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="min-w-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
      {hiddenCount > 0 && (
        <div className="py-2 text-center text-[11px] text-muted-foreground/40">
          ↑ 上还有 {hiddenCount} 条，滚动加载更多
        </div>
      )}
      {displayItems.map((block, i) => {
        const prev = displayItems[i - 1]
        const prevWasTool =
          prev?.kind === 'tool-group' ||
          (prev?.kind === 'single' && prev.item.type === 'tool-call')
        const curIsAssistant = block.kind === 'single' && block.item.type === 'assistant-message'
        const showGroupGap = prevWasTool && curIsAssistant

        if (block.kind === 'tool-group') {
          return (
            <Fragment key={block.groupId}>
              {showGroupGap && <div className="h-2" />}
              <div className="ui-enter">
                <ToolGroupSummary tools={block.tools} />
              </div>
            </Fragment>
          )
        }

        const { item, prevType } = block
        if (item.type === 'tool-call') {
          return (
            <Fragment key={item.id}>
              <div className="ui-enter">
                <ToolCallRow item={item} />
              </div>
            </Fragment>
          )
        }

        return (
          <Fragment key={item.id}>
            {showGroupGap && <div className="h-2" />}
            <TimelineItemBase item={item} prevType={prevType} />
          </Fragment>
        )
      })}
      <div className="h-4" />
    </div>
  )
}
