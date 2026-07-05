import { memo } from 'react'
import { cn } from '@renderer/lib/utils'

/** 与 resources/icon.svg 一致：黑底 + 衬线 π */
function PiMarkImpl({ className, size = 16 }: { className?: string; size?: number; inverted?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <rect width="1024" height="1024" rx="256" ry="256" className="fill-foreground" />
      <text
        x="512"
        y="740"
        textAnchor="middle"
        className="fill-background"
        style={{
          fontFamily: "'Times New Roman', Georgia, serif",
          fontSize: 760,
        }}
      >
        π
      </text>
    </svg>
  )
}

export const PiMark = memo(PiMarkImpl)