import { memo } from 'react'
import { Wrench } from 'lucide-react'

function formatTime(ts: number): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export const TurnFooter = memo(function TurnFooter({
  toolCount,
  endedAt,
  isLast,
  streaming,
}: {
  toolCount: number
  endedAt: number
  isLast: boolean
  streaming: boolean
}) {
  if (isLast && streaming) return null
  const time = formatTime(endedAt)
  if (!time && toolCount === 0) return null
  return (
    <div className="mx-0 mb-3 mt-1 flex items-center gap-2 border-t border-border/30 pt-2 text-[10px] text-foreground-secondary/70">
      {time ? <span className="tabular-nums">{time}</span> : null}
      {toolCount > 0 ? (
        <span className="inline-flex items-center gap-0.5">
          <Wrench className="h-3 w-3 opacity-60" />
          {toolCount}
        </span>
      ) : null}
    </div>
  )
})