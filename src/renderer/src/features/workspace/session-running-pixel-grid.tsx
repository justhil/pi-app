import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/utils'

const GRID = 3
const CELL_COUNT = GRID * GRID
const CELL_PX = 3
const GAP_PX = 1.5
const GRID_OUTER_PX = GRID * CELL_PX + (GRID - 1) * GAP_PX // 12px
const TRAIL_LENGTH = 4
const STEP_MS = 320

const NEIGHBORS: readonly (readonly number[])[] = [
  [1, 3, 4],
  [0, 2, 3, 4, 5],
  [1, 4, 5],
  [0, 1, 4, 6, 7],
  [0, 1, 2, 3, 5, 6, 7, 8],
  [1, 2, 4, 7, 8],
  [3, 4, 7],
  [3, 4, 5, 6, 8],
  [4, 5, 7],
]

function pickInitialTrail(): number[] {
  const start = Math.floor(Math.random() * CELL_COUNT)
  const trail = [start]
  while (trail.length < TRAIL_LENGTH) {
    const head = trail[trail.length - 1]
    const candidates = NEIGHBORS[head].filter((n) => !trail.includes(n))
    const pool = candidates.length > 0 ? candidates : Array.from({ length: CELL_COUNT }, (_, i) => i).filter((n) => !trail.includes(n))
    trail.push(pool[Math.floor(Math.random() * pool.length)])
  }
  return trail
}

function advanceTrail(prev: number[]): number[] {
  const dropped = prev[0]
  const rest = prev.slice(1)
  const head = rest[rest.length - 1] ?? 4
  const adjacent = NEIGHBORS[head].filter((n) => !rest.includes(n) && n !== dropped)
  const fallback = Array.from({ length: CELL_COUNT }, (_, i) => i).filter((n) => !rest.includes(n))
  const pool = adjacent.length > 0 && Math.random() < 0.72 ? adjacent : fallback
  const next = pool[Math.floor(Math.random() * pool.length)]
  return [...rest, next]
}

/**
 * 3×3 transparent-background organic micro-dot indicator for running sessions.
 * No grey box backdrop — 4 dots ripple smoothly across a 12×12 footprint with lead/mid/tail decay.
 */
export function SessionRunningPixelGrid({
  className,
  title,
}: {
  className?: string
  title?: string
}) {
  const [trail, setTrail] = useState<number[]>(() => pickInitialTrail())

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const timer = window.setInterval(() => {
      setTrail((prev) => advanceTrail(prev))
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      data-pi-slot="session-running-grid"
      className={cn('session-running-pixel-grid shrink-0', className)}
      title={title}
      aria-hidden
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(${GRID}, ${CELL_PX}px)`,
        gridTemplateRows: `repeat(${GRID}, ${CELL_PX}px)`,
        gap: `${GAP_PX}px`,
        width: GRID_OUTER_PX,
        height: GRID_OUTER_PX,
      }}
    >
      {Array.from({ length: CELL_COUNT }, (_, index) => {
        const pos = trail.indexOf(index)
        const level =
          pos === TRAIL_LENGTH - 1
            ? 'lead'
            : pos >= 1
              ? 'mid'
              : pos === 0
                ? 'tail'
                : null
        return (
          <span
            key={index}
            className={cn(
              'session-running-pixel',
              level && 'session-running-pixel--on',
              level && `session-running-pixel--${level}`,
            )}
          />
        )
      })}
    </span>
  )
}
