import { useState, type ReactNode } from 'react'
import { Copy, Check, Undo2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** 消息 hover 复制行：用 React hover 状态驱动，比纯 CSS group 更稳定可见 */
export function MessageHoverActions({
  text,
  timestamp,
  align,
  sessionEntryId,
  onRewind,
}: {
  text: string
  timestamp?: number
  align: 'left' | 'right'
  sessionEntryId?: string
  onRewind?: (entryId: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className={cn('flex h-8 items-center gap-2', align === 'right' && 'flex-row-reverse justify-end')}>
      {onRewind && (
        <button
          type="button"
          disabled={!sessionEntryId}
          onClick={() => sessionEntryId && onRewind(sessionEntryId)}
          className="chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary hover:text-primary disabled:opacity-35 disabled:pointer-events-none"
          title={
            sessionEntryId
              ? '跳转到此节点（同 TUI /tree）'
              : '跳转需会话 entry id（切换会话或发送一条消息后再试）'
          }
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        className="chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary"
        title="复制"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {timestamp != null && (
        <span className="select-none text-[11px] tabular-nums text-foreground-secondary">{new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      )}
    </div>
  )
}

export function MessageHoverShell({
  align,
  children,
  actions,
}: {
  align: 'left' | 'right'
  children: ReactNode
  actions: ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className={cn('message-hover-shell', align === 'right' && 'items-end')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {/* 固定高度占位，仅 opacity 变化，避免 hover 顶开布局（对齐 参考桌面客户端 h-32px） */}
      <div className={cn('message-actions-slot', hovered && 'message-actions-slot-visible')}>
        {actions}
      </div>
    </div>
  )
}