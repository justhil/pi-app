import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'
import { Wrench, FileText, FileEdit, Terminal, AlertCircle, Archive } from 'lucide-react'
import { useState } from 'react'

function ToolIcon({ name }: { name: string }) {
  if (name === 'read') return <FileText className="h-3.5 w-3.5 text-blue-500" />
  if (name === 'edit' || name === 'write') return <FileEdit className="h-3.5 w-3.5 text-amber-500" />
  if (name === 'bash') return <Terminal className="h-3.5 w-3.5 text-green-500" />
  return <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
}

function TimelineItem({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false)

  if (item.type === 'user-message') {
    return (
      <div className="py-3 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
            {item.text}
          </div>
        </div>
      </div>
    )
  }

  if (item.type === 'assistant-message') {
    return (
      <div className="py-3 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <div className="text-sm whitespace-pre-wrap text-foreground">
          {item.text || '...'}
        </div>
      </div>
    )
  }

  if (item.type === 'tool-call') {
    return (
      <div className="py-2 animate-in fade-in slide-in-from-bottom-1 duration-motion-normal ease-motion-ease">
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors duration-motion-fast ease-motion-ease',
            item.isError
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-border bg-muted/30 hover:bg-muted/50',
          )}
        >
          <ToolIcon name={item.toolName} />
          <span className="font-mono">{item.toolName}</span>
          {item.toolPhase === 'start' && (
            <span className="ml-auto text-muted-foreground animate-pulse">运行中...</span>
          )}
          {item.toolPhase === 'end' && (
            <span className={cn('ml-auto', item.isError ? 'text-destructive' : 'text-muted-foreground')}>
              {item.isError ? '失败' : '完成'}
            </span>
          )}
        </button>
        {expanded && item.toolOutput && (
          <div className="mt-1 overflow-auto rounded-md bg-muted/50 p-2 text-xs font-mono max-h-48">
            <pre className="whitespace-pre-wrap break-all">{item.toolOutput}</pre>
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'compaction') {
    return (
      <div className="py-2">
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          <Archive className="h-3.5 w-3.5" />
          <span>已压缩历史</span>
          {item.text && (
            <span className="truncate opacity-60">{item.text.slice(0, 80)}...</span>
          )}
        </div>
      </div>
    )
  }

  if (item.type === 'error') {
    return (
      <div className="py-2">
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{item.text}</span>
        </div>
      </div>
    )
  }

  return null
}

export function Timeline() {
  const items = useUIStore((s) => s.timelineItems)
  const { t } = useTranslation()

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm text-muted-foreground/50">
          {t('timeline.placeholder')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2">
      {items.map((item) => (
        <TimelineItem key={item.id} item={item} />
      ))}
    </div>
  )
}
