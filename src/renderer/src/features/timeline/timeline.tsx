import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import {
  FileText, FileEdit, Terminal, Wrench, AlertCircle, Archive,
  ChevronRight, CheckCircle2, XCircle, Loader2, User, Bot,
  MessageCircleQuestion, Image as ImageIcon, GitBranch, CornerDownLeft, Globe
} from 'lucide-react'
import { useState, memo, useRef, useEffect, useCallback } from 'react'
import { syntaxHighlight } from '@renderer/lib/syntax-highlight'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ImageToolCard } from './image-tool-card'
import { SubagentToolCard } from './subagent-tool-card'
import { ThinkingIndicator, StreamingCaret, useStalledHint } from './tool-card-primitives'
import { resolveToolCard, EXPORT_TOOLS, ASK_TOOL } from './tool-card-registry'

// Enhanced tool output renderer: special cards for ask/image/trellis, default code block otherwise.
// Render artifact paths from tool details (preview_export / studio_export_* / image_gen etc.)
function ArtifactPaths({ paths, format }: { paths: string[]; format?: string }) {
  if (!paths || paths.length === 0) return null
  const open = (p: string) => ipcClient.invoke('shell.openPath', { path: p }).catch(() => {})
  const reveal = (p: string) => ipcClient.invoke('shell.showItemInFolder', { path: p }).catch(() => {})
  return (
    <div className="mt-1 mb-1 flex flex-wrap gap-1.5">
      {paths.map((p, i) => {
        const name = p.split(/[\\/]/).pop() || p
        const fmt = format ? format.toUpperCase() : ''
        return (
          <div key={i} className="flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5">
            <FileText className="h-3 w-3 text-blue-500" />
            <span className="font-mono text-[10px]">{fmt && <span className="text-muted-foreground/50 mr-1">{fmt}</span>}{name}</span>
            <button onClick={() => open(p)} className="rounded px-1 text-[10px] text-primary hover:underline">打开</button>
            <button onClick={() => reveal(p)} className="rounded px-1 text-[10px] text-muted-foreground hover:text-foreground">文件夹</button>
          </div>
        )
      })}
    </div>
  )
}

function ToolOutputExpanded({ item }: { item: any }) {
  const out = item.toolOutput || ''
  const details = item.toolDetails
  const detailPaths: string[] = Array.isArray(details?.paths) ? details.paths : []

  // Export-type tools -> artifact paths first
  const isExportTool = EXPORT_TOOLS.has(item.toolName || '')
  if (isExportTool && detailPaths.length > 0) {
    return (
      <div className="mt-1">
        <ArtifactPaths paths={detailPaths} format={details?.format} />
        <div className="mt-1 overflow-hidden rounded-lg border border-border/50 bg-muted/40">
          <div className="overflow-auto p-2.5 text-[11px] font-mono leading-relaxed max-h-40 text-green-600/80">
            已导出 {detailPaths.length} 个文件（{details?.format?.toUpperCase() || '文件'}）。点击上方按钮打开或定位。
          </div>
        </div>
      </div>
    )
  }

  // ask_user_question: try to parse question payload
  if (item.toolName === ASK_TOOL) {
    let parsed: any = null
    try { parsed = typeof out === 'string' ? JSON.parse(out) : out } catch { parsed = null }
    const questions = parsed?.questions || parsed?.input?.questions
    if (Array.isArray(questions) && questions.length > 0) {
      return (
        <div className="mt-1 space-y-2 rounded-lg border border-purple-500/30 bg-purple-500/5 p-2.5">
          {questions.map((q: any, i: number) => (
            <div key={i}>
              <div className="text-[12px] font-medium">{q.question}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(q.options || []).map((o: any) => (
                  <span key={o.label} className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-700 dark:text-purple-300">
                    {o.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }
  }

  const SpecializedCard = resolveToolCard(item.toolName)
  if (SpecializedCard) {
    return <SpecializedCard item={item} />
  }

  // default: syntax-highlighted code block
  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-border/50 bg-muted/40">
      <div className="overflow-auto p-2.5 text-[11px] font-mono leading-relaxed max-h-56">
        <pre className="whitespace-pre-wrap break-all text-muted-foreground" dangerouslySetInnerHTML={{ __html: syntaxHighlight(out, item.toolName) }} />
      </div>
    </div>
  )
}

function ToolIcon({ name }: { name: string }) {
  const cls = "h-3.5 w-3.5"
  if (name === 'read') return <FileText className={cn(cls, "text-[hsl(var(--tool-read))]")} />
  if (name === 'edit' || name === 'write') return <FileEdit className={cn(cls, "text-[hsl(var(--tool-edit))]")} />
  if (name === 'bash') return <Terminal className={cn(cls, "text-[hsl(var(--tool-bash))]")} />
  if (name === 'ask_user_question') return <MessageCircleQuestion className={cn(cls, "text-purple-500")} />
  if (name === 'image_gen' || name === 'image_review' || name === 'analyze_image') return <ImageIcon className={cn(cls, "text-pink-500")} />
  if (name === 'search' || name === 'search_sources' || name === 'docs_search' || name === 'web_fetch' || name === 'web_map' || name.startsWith('context7_') || name.startsWith('plan_') || name === 'search_config' || name === 'search_planning') return <Globe className={cn(cls, 'text-sky-500')} />
  if (name === 'trellis_subagent' || name === 'subagent' || name === 'contact_supervisor') return <GitBranch className={cn(cls, "text-blue-500")} />
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
      return <ThinkingIndicator label="思考中" />
    }
    // Streaming: text is non-final while the streaming flag is set on this item.
    const streaming = (useUIStore.getState().streamingAssistantId === item.id)
    const stalled = useStalledHint(streaming, item.text?.length)
    return (
      <div className="py-2.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="flex items-start gap-2.5">
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <div className="text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
            {item.text}
            {streaming && <StreamingCaret />}
          </div>
        </div>
        {stalled && (
          <div className="mt-1 pl-6 text-[10px] text-muted-foreground/50">思考中…</div>
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
      <div className="py-1.5 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <button
          onClick={() => hasToolBody && setExpanded(!expanded)}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 transition-all duration-motion-fast ease-motion-ease',
            item.isError
              ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
              : 'border-border/70 bg-muted/30 hover:bg-muted/50',
            !hasToolBody && 'cursor-default',
          )}
        >
          {hasToolBody && (
            <ChevronRight className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-motion-fast',
              expanded && 'rotate-90'
            )} />
          )}
          <ToolIcon name={item.toolName} />
          <span className="text-[12px] font-mono font-medium text-foreground/80">{item.toolName}</span>
          {rawSum && (
            <span className="ml-1 max-w-[260px] truncate text-[10px] text-muted-foreground/55">{rawSum}</span>
          )}
          {isRunning && <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />}
          {!isRunning && item.isError && <XCircle className="ml-auto h-3.5 w-3.5 text-destructive" />}
          {!isRunning && !item.isError && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500/70" />}
        </button>
        {expanded && hasToolBody && (
          <div className="animate-in fade-in slide-in-from-bottom-1 duration-motion-fast ease-motion-ease">
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
