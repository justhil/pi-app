import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { CollapsiblePanel } from '@renderer/components/ui/collapsible-panel'

/** 思维链：淡色、默认折叠，运行中可自动展开 */
export function ThinkingChainBlock({
  text,
  streaming,
}: {
  text: string
  /** 仅当前正在流式的那条助手消息自动展开思维链 */
  streaming?: boolean
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? !!streaming
  const preview = text.trim().split('\n').filter(Boolean).slice(0, 2).join('\n')
  const lineCount = text.trim().split('\n').filter(Boolean).length

  if (!text.trim()) return null

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        className="row-hover flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left"
      >
        <ChevronRight className={cn('chevron-expand h-3 w-3 text-foreground-secondary/50', open && 'rotate-90')} />
        <span className="text-[11px] text-foreground-secondary/55">
          思维链{lineCount > 0 ? ` · ${lineCount} 行` : ''}
          {streaming ? ' · 生成中' : ''}
        </span>
      </button>
      <CollapsiblePanel open={open} className="mt-0.5">
        <div
          className="ml-4 max-h-48 overflow-auto border-l border-border/30 pl-2 text-[12px] leading-[1.55] text-foreground-secondary/45 whitespace-pre-wrap break-words font-mono"
        >
          {open ? text : preview}
        </div>
      </CollapsiblePanel>
    </div>
  )
}