import { memo, useState, type ReactNode } from 'react'
import { Copy, Check, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

/** Hover actions for messages: copy, rewind */
function MessageHoverActionsImpl({
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
  const { t } = useTranslation()
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
              ? t('timeline:jumpToNode')
              : t('timeline:jumpNeedEntry')
          }
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        className="chrome-icon-btn flex h-7 w-7 items-center justify-center rounded-md text-foreground-secondary"
        title={t('timeline:copy')}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {timestamp != null && (
        <span className="select-none text-[11px] tabular-nums text-foreground-secondary">{new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      )}
    </div>
  )
}

export const MessageHoverActions = memo(MessageHoverActionsImpl)

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