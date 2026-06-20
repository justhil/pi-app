import { useState, type ReactNode } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** 消息 hover 复制行：用 React hover 状态驱动，比纯 CSS group 更稳定可见 */
export function MessageHoverActions({
  text,
  timestamp,
  align,
}: {
  text: string
  timestamp?: number
  align: 'left' | 'right'
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className={cn('mt-1 flex h-7 items-center gap-2', align === 'right' && 'flex-row-reverse justify-end')}>
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
      className={cn('message-hover-shell', align === 'right' && 'items-end', hovered && 'message-hover-shell-active')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <div className={cn('message-actions-fade', hovered && 'message-actions-fade-visible')}>{actions}</div>
    </div>
  )
}