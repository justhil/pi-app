import { cn } from '@renderer/lib/utils'
import type { SessionAttention } from '@renderer/lib/session-attention'

export function SessionAttentionDot({
  attention,
  title,
  className,
}: {
  attention: SessionAttention
  title?: string
  className?: string
}) {
  if (attention === 'idle') return null
  return (
    <span
      className={cn('session-attention-dot', `session-attention-dot--${attention}`, className)}
      title={title}
      aria-hidden
    >
      {attention === 'needs-you' ? '?' : null}
    </span>
  )
}
