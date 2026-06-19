// Tool card templates & collapsible tool row (兼容层 v2 + ui-timeline-polish)
// 工具行默认淡化小字 + 一行摘要，点击展开详情。渲染走 adapter.toolCard.template 查表，无则 default。
import { useState, memo, useEffect } from 'react'
import { cn } from '@renderer/lib/utils'
import { syntaxHighlight } from '@renderer/lib/syntax-highlight'
import { Loader2, ChevronRight, CheckCircle2, XCircle, FileText, FileEdit, Terminal, Wrench, Image as ImageIcon, Globe, GitBranch, MessageCircleQuestion } from 'lucide-react'
import * as Collapsible from '@radix-ui/react-collapsible'

interface ToolItem {
  id: string
  toolName?: string
  toolOutput?: string
  toolDetails?: any
  toolPhase?: string
  toolStatusLine?: string
  isError?: boolean
}

// 一行淡化摘要：优先 toolStatusLine，否则 toolOutput 首行 truncate
function summarize(item: ToolItem): string {
  if (item.toolStatusLine) return String(item.toolStatusLine)
  const out = (item.toolOutput || '').trim()
  if (!out) return ''
  const firstLine = out.split('\n').find((l) => l.trim()) || ''
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine
}

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const cls = className || 'h-3.5 w-3.5'
  if (name === 'read') return <FileText className={cn(cls, 'text-[hsl(var(--tool-read))]')} />
  if (name === 'edit' || name === 'write') return <FileEdit className={cn(cls, 'text-[hsl(var(--tool-edit))]')} />
  if (name === 'bash') return <Terminal className={cn(cls, 'text-[hsl(var(--tool-bash))]')} />
  if (name === 'ask_user_question') return <MessageCircleQuestion className={cn(cls, 'text-purple-500')} />
  if (name === 'image_gen' || name === 'image_review' || name === 'analyze_image') return <ImageIcon className={cn(cls, 'text-pink-500')} />
  if (name === 'trellis_subagent' || name === 'subagent' || name === 'contact_supervisor') return <GitBranch className={cn(cls, 'text-blue-500')} />
  if (name === 'search' || name === 'search_sources' || name === 'docs_search' || name === 'web_fetch') return <Globe className={cn(cls, 'text-sky-500')} />
  return <Wrench className={cn(cls, 'text-muted-foreground')} />
}

// 工具详情内容（展开后）。default = 语法高亮代码；其它模板可在 adapter 体系增强。
function ToolDetail({ item, template }: { item: ToolItem; template?: string }) {
  const out = (item.toolOutput || '').trim()
  if (!out) return null
  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-border/50 bg-muted/40">
      <div className="overflow-auto p-2.5 text-[11px] font-mono leading-relaxed max-h-56">
        <pre className="whitespace-pre-wrap break-all text-muted-foreground" dangerouslySetInnerHTML={{ __html: syntaxHighlight(out, item.toolName || '') }} />
      </div>
    </div>
  )
}

/**
 * Collapsible tool row: default collapsed showing tool name + dimmed single-line summary,
 * expand on click for full detail. Runs status shows spinner + summary line.
 */
export const CollapsibleToolRow = memo(function CollapsibleToolRow({
  item,
  toolCardTemplate,
}: {
  item: ToolItem
  toolCardTemplate?: string
}) {
  const [open, setOpen] = useState(false)
  const isRunning = item.toolPhase === 'start' || item.toolPhase === 'update'
  const summary = summarize(item)
  const hasBody = !!item.toolOutput || (!!summary && isRunning)

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger asChild>
        <button
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 transition-all duration-motion-fast ease-motion-ease',
            item.isError ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10' : 'border-border/70 bg-muted/30 hover:bg-muted/50',
          )}
        >
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-motion-fast', open && 'rotate-90')} />
          <ToolIcon name={item.toolName || ''} />
          <span className="text-[12px] font-mono font-medium text-foreground/80">{item.toolName}</span>
          {summary && (
            <span className="ml-1 max-w-[280px] truncate text-[10px] text-muted-foreground/60">{summary}</span>
          )}
          {isRunning && <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />}
          {!isRunning && item.isError && <XCircle className="ml-auto h-3.5 w-3.5 text-destructive" />}
          {!isRunning && !item.isError && hasBody && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500/70" />}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out">
        <div className="pl-5 pt-1">
          <ToolDetail item={item} template={toolCardTemplate} />
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
})

// Thinking/streaming indicator: shimmer text instead of 3 bounce dots (桌面 Agent UI-inspired)
export function ThinkingIndicator({ label = '思考中' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-2.5">
      <span
        className="text-[12px] text-muted-foreground"
        style={{
          background: 'linear-gradient(90deg, hsl(var(--muted-foreground)) 0%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 100%)',
          backgroundSize: '200% 100%',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          color: 'transparent',
          animation: 'shimmer-scan 2s linear infinite',
        }}
      >
        {label}…
      </span>
    </div>
  )
}

// Streaming caret appended to in-progress assistant text
export function StreamingCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-foreground/70 animate-caret-blink"
      aria-hidden
    />
  )
}

// Show a subtle "思考中" hint after the streaming delta has been silent for >stallMs.
// Pass a `deltaKey` that changes on each token (e.g. text length) so the timer resets while streaming is active.
export function useStalledHint(streaming: boolean, deltaKey: unknown, stallMs = 800): boolean {
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (!streaming) { setStalled(false); return }
    setStalled(false)
    const t = setTimeout(() => setStalled(true), stallMs)
    return () => clearTimeout(t)
  }, [streaming, deltaKey, stallMs])
  return stalled
}

// shared keyframes shim (in case Tailwind plugin order misses it)
export const _shimmerKeyframes = `@keyframes shimmer-scan { 0% { background-position: 100% 0; } } 100% { background-position: -100% 0; } }`
