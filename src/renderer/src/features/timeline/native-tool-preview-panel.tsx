import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

/** 主流 Agent 桌面/Cursor 风格：默认折叠摘要，展开看详情 */
export function NativePreviewPanel({
  icon,
  title,
  meta,
  stats,
  defaultOpen = false,
  forceOpen,
  itemRunId,
  children,
}: {
  icon: ReactNode
  title: string
  meta?: ReactNode
  stats?: ReactNode
  defaultOpen?: boolean
  /** 仅当前 run 的工具预览在运行中自动展开 */
  forceOpen?: boolean
  itemRunId?: string
  children: ReactNode
}) {
  const agentRunning = useUIStore((s) => s.runState.status === 'running')
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const liveThisRun = agentRunning && !!itemRunId && itemRunId === activeRunId
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const autoOpen = forceOpen ?? (liveThisRun ? true : defaultOpen)
  const open = userOpen ?? autoOpen

  return (
    <div className="overflow-hidden rounded-lg border border-border/50" style={{ background: 'var(--bg-2)' }}>
      <button
        type="button"
        onClick={() => setUserOpen(!(userOpen ?? autoOpen))}
        className="row-hover flex w-full items-center gap-2 border-b border-border/40 px-2.5 py-2 text-left"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{title}</span>
        {meta}
        {stats}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-foreground-secondary transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-border/30 bg-[var(--bg-base)]/40">{children}</div>}
    </div>
  )
}